/*
Rotina para obtenção da assinatura espectro-temporal de seringais (Sentinel-2/MSI)
Versão 3.1: seringal x outras coberturas (pivô, cana, pasto, eucalipto, mata)
Resultados exportados em CSV (Tasks) para evitar o limite de memória do console
NDVI + NDMI | Cloud Score+ | decêndios | métricas fenológicas | teste das regras candidatas
*/

// =====================================================================
// BLOCO 1 - PARÂMETROS (só é preciso alterar aqui)
// =====================================================================
var ANO = 2025;              // ano de análise (rodar com 2025 e com 2024)
var BUFFER_M = 50;           // raio do buffer em torno de cada ponto (m)
var NUVEM_MAX = 60;          // % máxima de nuvem da cena (filtro inicial)
var CS_LIMIAR = 0.60;        // Cloud Score+: pixel limpo se cs_cdf >= 0,60

// Janelas fenológicas (mês-dia)
var MIN_INICIO = '-06-01', MIN_FIM = '-09-01';     // MÍNIMO (desfolha): jun a ago
var DIAS_APOS_MIN = 70;                            // MÁXIMO: até 70 dias depois do mínimo
var CHUVA_INICIO = '-01-01', CHUVA_FIM = '-05-01'; // copa cheia (chuva): jan a abr
var ESPECTRO_INICIO = '-07-15', ESPECTRO_FIM = '-07-31';

// Regras candidatas (limiares em teste)
var LIMIARES = {
  NDMI_min: -0.09,   // R1: NDMI mínimo na seca  <= -0,09  (desfolha expõe galhos e serrapilheira)
  NDMI_amp: 0.47,    // R2: amplitude do NDMI    >=  0,47
  NDVI_amp: 0.36,    // R3: amplitude do NDVI    >=  0,36
  NDVI_max: 0.80,    // R4: NDVI máximo pós-rebrota >= 0,80 (copa densa e rápida)
  NDVI_chuva: 0.60   // R5: NDVI na chuva (p10 jan-abr) >= 0,60 (copa estável; exclui pivô)
};

var GRAFICOS_NO_GEE = false;          // true = gráficos/tabelas no console (pode estourar a memória)
                                      // false = só gera os CSVs na aba Tasks (recomendado)
var MOSTRAR_GRUPOS_SERINGAL = true;   // gráficos extras: seringais separados por grupo
var MOSTRAR_LOCALIZADOR = false;      // camada magenta de candidatos (ajuda a achar pontos)

// =====================================================================
// BLOCO 2 - ÁREA DE ESTUDO E PONTOS (seringal + outras coberturas)
// =====================================================================
var RGI = rgi_cg.merge(rgi_uba).merge(rgi_udi).merge(rgi_ara).merge(rgi_sjp).merge(rgi_rp);
var area = RGI;

var seringais = grupo_1.merge(grupo_2).merge(grupo_3).merge(grupo_4)
  .map(function(f){ return f.set('classe', 'Seringal'); });
var outrasCoberturas = pivo.merge(cana).merge(pasto).merge(eucalipto).merge(mata)
  .map(function(f){ return f.set('classe', f.get('Name')); });
var pontos = seringais.merge(outrasCoberturas);

// Buffer de 50 m em torno de cada ponto (~78 pixels de 10 m)
var buffers = pontos.map(function(f){
  return ee.Feature(f.buffer(BUFFER_M).copyProperties(f));
});

// Numera cada ponto (id = 1, 2, 3...)
var listaBuffers = buffers.toList(buffers.size());
var buffersId = ee.FeatureCollection(
  ee.List.sequence(0, buffers.size().subtract(1)).map(function(i){
    return ee.Feature(listaBuffers.get(i)).set('id', ee.Number(i).add(1));
  })
);

// Une os buffers de uma mesma categoria em uma feição (para os gráficos)
function unePor(campo, fc){
  var nomes = fc.aggregate_array(campo).distinct();
  return ee.FeatureCollection(nomes.map(function(n){
    var props = {};
    props[campo] = n;
    return ee.Feature(fc.filter(ee.Filter.eq(campo, n)).geometry(), props);
  }));
}
var classesUnidas = unePor('classe', buffers);
var gruposUnidos = unePor('Name', buffers.filter(ee.Filter.eq('classe', 'Seringal')));

print('Pontos por classe:', buffers.aggregate_histogram('classe'));

// =====================================================================
// BLOCO 3 - COLEÇÃO SENTINEL-2 COM MÁSCARA DE NUVENS CLOUD SCORE+
// =====================================================================
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

var colecao_Sentinel_2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate(ANO + '-01-01', (ANO + 1) + '-01-01')
  .filterBounds(buffers)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', NUVEM_MAX))
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function(img){
    return img.updateMask(img.select('cs_cdf').gte(CS_LIMIAR)).select('B.*');
  });

print('Imagens Sentinel-2 utilizadas em ' + ANO + ':', colecao_Sentinel_2.size());

// =====================================================================
// BLOCO 4 - ÍNDICES DE VEGETAÇÃO: NDVI e NDMI
// =====================================================================
// NDVI = (B8 - B4) / (B8 + B4)   -> vigor / clorofila (Rouse et al., 1974)
// NDMI = (B8 - B11) / (B8 + B11) -> água no dossel (Gao, 1996)
var colecao_indices = colecao_Sentinel_2.map(function(img){
  var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndmi = img.normalizedDifference(['B8', 'B11']).rename('NDMI');
  return ee.Image(ndvi.addBands(ndmi).float()
    .copyProperties(img, ['system:time_start']));
});

// =====================================================================
// BLOCO 5 - COMPOSTOS POR DECÊNDIO (36 por ano, mediana)
// =====================================================================
var imagemVazia = ee.Image.constant([0, 0]).rename(['NDVI', 'NDMI']).float().updateMask(0);

function composto(col, inicio, fim, rotulo){
  var sub = col.filterDate(inicio, fim);
  return ee.Image(ee.Algorithms.If(sub.size().gt(0), sub.median(), imagemVazia))
    .set('system:time_start', inicio.millis())
    .set('decendio', rotulo)
    .set('n_imagens', sub.size());
}

function agregaDecendios(col, ano){
  var meses = ee.List.sequence(1, 12);
  return ee.ImageCollection.fromImages(meses.map(function(m){
    var inicioMes = ee.Date.fromYMD(ano, m, 1);
    var dia11 = inicioMes.advance(10, 'day');
    var dia21 = inicioMes.advance(20, 'day');
    var fimMes = inicioMes.advance(1, 'month');
    var mes = ee.Number(m).toInt().format();
    return [
      composto(col, inicioMes, dia11, ee.String('D1_M').cat(mes)),
      composto(col, dia11, dia21, ee.String('D2_M').cat(mes)),
      composto(col, dia21, fimMes, ee.String('D3_M').cat(mes))
    ];
  }).flatten());
}

var colecao_decendial = agregaDecendios(colecao_indices, ANO);

print('Decêndios sem nenhuma imagem limpa (de 36):',
  colecao_decendial.filter(ee.Filter.eq('n_imagens', 0)).size());

// =====================================================================
// BLOCO 6 - GRÁFICOS DAS SÉRIES TEMPORAIS
// =====================================================================
function graficoSerie(banda, regioes, campo, complemento){
  return ui.Chart.image.seriesByRegion({
    imageCollection: colecao_decendial,
    regions: regioes,
    reducer: ee.Reducer.mean(),
    band: banda,
    scale: 10,
    xProperty: 'system:time_start',
    seriesProperty: campo
  }).setOptions({
    title: banda + ' por decêndio - ' + complemento + ' (' + ANO + ')',
    hAxis: {title: 'Período', titleTextStyle: {italic: false, bold: true}},
    vAxis: {title: banda, titleTextStyle: {italic: false, bold: true}},
    chartArea: {backgroundColor: '#f0f0f0'},
    lineWidth: 1,
    pointSize: 3,
    interpolateNulls: true
  });
}
if (GRAFICOS_NO_GEE) {
  print(graficoSerie('NDVI', classesUnidas, 'classe', 'por cobertura'));
  print(graficoSerie('NDMI', classesUnidas, 'classe', 'por cobertura'));
}
if (GRAFICOS_NO_GEE && MOSTRAR_GRUPOS_SERINGAL) {
  print(graficoSerie('NDVI', gruposUnidos, 'Name', 'seringais por grupo'));
  print(graficoSerie('NDMI', gruposUnidos, 'Name', 'seringais por grupo'));
}

// =====================================================================
// BLOCO 7 - MÉTRICAS FENOLÓGICAS (pixel a pixel, como na detecção)
// =====================================================================
function metricasFenologicas(indice){
  var comDia = colecao_decendial.map(function(img){
    var v = img.select(indice);
    var dia = ee.Date(img.get('system:time_start')).getRelative('day', 'year').add(1);
    return v.addBands(ee.Image.constant(dia).float().rename('DIA'))
            .addBands(v.multiply(-1).rename('INVERSO'))
            .updateMask(v.mask());
  });

  // 1) MÍNIMO: decêndio com o menor valor dentro da janela de desfolha
  var minimo = comDia.filterDate(ANO + MIN_INICIO, ANO + MIN_FIM)
    .qualityMosaic('INVERSO')
    .select([indice, 'DIA'], [indice + '_min', indice + '_dia_min']);
  var diaMin = minimo.select(indice + '_dia_min');

  // 2) MÁXIMO: maior valor entre o mínimo e DIAS_APOS_MIN dias depois (em cada pixel)
  var maximo = comDia.map(function(img){
      var d = img.select('DIA');
      return img.updateMask(d.gt(diaMin).and(d.lte(diaMin.add(DIAS_APOS_MIN))));
    })
    .qualityMosaic(indice)
    .select([indice, 'DIA'], [indice + '_max', indice + '_dia_max']);

  // 3) AMPLITUDE = máximo - mínimo
  var amplitude = maximo.select(indice + '_max')
    .subtract(minimo.select(indice + '_min')).rename(indice + '_amp');
  return minimo.addBands(maximo).addBands(amplitude);
}

// 4) ESTABILIDADE NA CHUVA: percentil 10 do NDVI de jan a abr (copa cheia)
var ndviChuva = colecao_decendial.filterDate(ANO + CHUVA_INICIO, ANO + CHUVA_FIM)
  .select('NDVI').reduce(ee.Reducer.percentile([10])).rename('NDVI_chuva');

var metricas = metricasFenologicas('NDVI')
  .addBands(metricasFenologicas('NDMI'))
  .addBands(ndviChuva);

// Média das métricas dentro do buffer de cada ponto
var inicioAno = ee.Date.fromYMD(ANO, 1, 1);
function diaParaData(f, prop){
  var v = f.get(prop);
  return ee.Algorithms.If(v,
    inicioAno.advance(ee.Number(v).round().subtract(1), 'day').format('dd/MM'),
    'sem dado');
}

var tabela = metricas.reduceRegions({
  collection: buffersId,
  reducer: ee.Reducer.mean(),
  scale: 10,
  tileScale: 4
}).map(function(f){
  return f.set({
    ano: ANO,
    NDVI_data_min: diaParaData(f, 'NDVI_dia_min'),
    NDVI_data_max: diaParaData(f, 'NDVI_dia_max'),
    NDMI_data_min: diaParaData(f, 'NDMI_dia_min'),
    NDMI_data_max: diaParaData(f, 'NDMI_dia_max')
  });
});

var colunas = ['id', 'classe', 'Name', 'ano',
  'NDVI_min', 'NDVI_data_min', 'NDVI_max', 'NDVI_data_max', 'NDVI_amp',
  'NDMI_min', 'NDMI_data_min', 'NDMI_max', 'NDMI_data_max', 'NDMI_amp', 'NDVI_chuva'];

// Exporta a tabela para o Google Drive (aba Tasks -> RUN)
Export.table.toDrive({
  collection: tabela,
  description: 'assinatura_classes_' + ANO,
  fileFormat: 'CSV',
  selectors: colunas
});

// Série temporal de cada ponto (36 decêndios x todos os pontos) -> usada para os gráficos
var series = colecao_decendial.map(function(img){
  var data = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd');
  return img.reduceRegions({
    collection: buffersId.select(['id', 'classe', 'Name']),
    reducer: ee.Reducer.mean(),
    scale: 10,
    tileScale: 4
  }).map(function(f){
    return f.set({ano: ANO, data: data, decendio: img.get('decendio')});
  });
}).flatten();

Export.table.toDrive({
  collection: series,
  description: 'series_classes_' + ANO,
  fileFormat: 'CSV',
  selectors: ['id', 'classe', 'Name', 'ano', 'decendio', 'data', 'NDVI', 'NDMI']
});

// =====================================================================
// BLOCO 8 - COMPARAÇÃO ENTRE COBERTURAS E TESTE DAS REGRAS
// =====================================================================
var metricasNum = ['NDVI_min', 'NDVI_max', 'NDVI_amp', 'NDMI_min', 'NDMI_max', 'NDMI_amp', 'NDVI_chuva'];

var regras = [
  {nome: 'R1 NDMI mín ≤ ' + LIMIARES.NDMI_min, teste: function(p){ return p.NDMI_min <= LIMIARES.NDMI_min; }},
  {nome: 'R2 NDMI amp ≥ ' + LIMIARES.NDMI_amp, teste: function(p){ return p.NDMI_amp >= LIMIARES.NDMI_amp; }},
  {nome: 'R3 NDVI amp ≥ ' + LIMIARES.NDVI_amp, teste: function(p){ return p.NDVI_amp >= LIMIARES.NDVI_amp; }},
  {nome: 'R4 NDVI máx ≥ ' + LIMIARES.NDVI_max, teste: function(p){ return p.NDVI_max >= LIMIARES.NDVI_max; }},
  {nome: 'R5 NDVI chuva ≥ ' + LIMIARES.NDVI_chuva, teste: function(p){ return p.NDVI_chuva >= LIMIARES.NDVI_chuva; }}
];

function valido(x){ return x !== null && x !== undefined; }

if (GRAFICOS_NO_GEE) tabela.select(['classe'].concat(metricasNum), null, false).evaluate(function(fc){
  if (!fc || !fc.features) { print('Sem resultado na tabela.'); return; }

  // Agrupa os pontos por classe
  var porClasse = {};
  var ordem = [];
  fc.features.forEach(function(f){
    var p = f.properties;
    var c = p.classe;
    if (!porClasse[c]) {
      porClasse[c] = {n: 0, soma: {}, cont: {}, passa: [0, 0, 0, 0, 0], todas: 0};
      ordem.push(c);
    }
    var o = porClasse[c];
    o.n++;
    metricasNum.forEach(function(k){
      if (valido(p[k])) { o.soma[k] = (o.soma[k] || 0) + p[k]; o.cont[k] = (o.cont[k] || 0) + 1; }
    });
    var todasOk = true;
    regras.forEach(function(r, i){
      var ok = r.teste(p);
      if (ok) { o.passa[i]++; } else { todasOk = false; }
    });
    if (todasOk) { o.todas++; }
  });

  // Tabela A: média de cada métrica por classe
  var tA = {cols: [{label: 'Classe', type: 'string'}, {label: 'n', type: 'number'}], rows: []};
  metricasNum.forEach(function(k){ tA.cols.push({label: k, type: 'number'}); });
  ordem.forEach(function(c){
    var o = porClasse[c];
    var linha = [{v: c}, {v: o.n}];
    metricasNum.forEach(function(k){
      var m = o.cont[k] ? o.soma[k] / o.cont[k] : null;
      linha.push({v: m, f: m === null ? '-' : m.toFixed(2)});
    });
    tA.rows.push({c: linha});
  });
  print('TABELA A - Média das métricas por cobertura (' + ANO + ')');
  print(ui.Chart(tA).setChartType('Table'));

  // Tabela B: % de pontos de cada classe que passam em cada regra
  var tB = {cols: [{label: 'Classe', type: 'string'}], rows: []};
  regras.forEach(function(r){ tB.cols.push({label: r.nome, type: 'number'}); });
  tB.cols.push({label: 'TODAS as regras', type: 'number'});
  ordem.forEach(function(c){
    var o = porClasse[c];
    var linha = [{v: c}];
    o.passa.forEach(function(x){ var pct = 100 * x / o.n; linha.push({v: pct, f: pct.toFixed(0) + '%'}); });
    var pctT = 100 * o.todas / o.n;
    linha.push({v: pctT, f: pctT.toFixed(0) + '%'});
    tB.rows.push({c: linha});
  });
  print('TABELA B - % de pontos que passam em cada regra (' + ANO + '). Ideal: Seringal 100% e demais 0% em TODAS');
  print(ui.Chart(tB).setChartType('Table'));
});

// Gráficos de dispersão: cada ponto é um buffer, colorido pela cobertura
if (GRAFICOS_NO_GEE) print(ui.Chart.feature.groups({
    features: tabela, xProperty: 'NDMI_amp', yProperty: 'NDVI_chuva', seriesProperty: 'classe'
  }).setChartType('ScatterChart').setOptions({
    title: 'Amplitude do NDMI x NDVI na chuva (' + ANO + ')',
    hAxis: {title: 'Amplitude NDMI (R2)'}, vAxis: {title: 'NDVI na chuva - p10 jan-abr (R5)'}, pointSize: 6
  }));
if (GRAFICOS_NO_GEE) print(ui.Chart.feature.groups({
    features: tabela, xProperty: 'NDMI_min', yProperty: 'NDVI_max', seriesProperty: 'classe'
  }).setChartType('ScatterChart').setOptions({
    title: 'NDMI mínimo x NDVI máximo pós-rebrota (' + ANO + ')',
    hAxis: {title: 'NDMI mínimo na seca (R1)'}, vAxis: {title: 'NDVI máximo pós-rebrota (R4)'}, pointSize: 6
  }));

// =====================================================================
// BLOCO 9 - GRÁFICO DE RESPOSTA ESPECTRAL POR COBERTURA (período de desfolha)
// =====================================================================
var bandasOrdenadas = ['B1','B2','B3','B4','B5','B6','B7','B8','B8A','B9','B11','B12'];
var labelsEixo = [
  'B1 (443nm)','B2 (490nm)','B3 (560nm)','B4 (665nm)',
  'B5 (705nm)','B6 (740nm)','B7 (783nm)','B8 (842nm)',
  'B8A (865nm)','B9 (945nm)','B11 (1610nm)','B12 (2190nm)'
];

var valores = colecao_Sentinel_2
  .filterDate(ANO + ESPECTRO_INICIO, ANO + ESPECTRO_FIM)
  .select(bandasOrdenadas)
  .median()
  .multiply(0.0001)
  .reduceRegions({collection: classesUnidas, reducer: ee.Reducer.mean(), scale: 10, tileScale: 4});

Export.table.toDrive({
  collection: valores,
  description: 'espectro_classes_' + ANO,
  fileFormat: 'CSV',
  selectors: ['classe'].concat(bandasOrdenadas)
});


if (GRAFICOS_NO_GEE) valores.evaluate(function(fc){
  if (!fc || !fc.features || fc.features.length === 0) {
    print('Sem imagens limpas na janela do gráfico espectral.');
    return;
  }
  var dataTable = {cols: [{label: 'Banda', type: 'string'}], rows: []};
  fc.features.forEach(function(f){ dataTable.cols.push({label: f.properties.classe, type: 'number'}); });
  bandasOrdenadas.forEach(function(b, i){
    var linha = [{v: labelsEixo[i]}];
    fc.features.forEach(function(f){ linha.push({v: f.properties[b]}); });
    dataTable.rows.push({c: linha});
  });
  print(ui.Chart(dataTable).setChartType('LineChart').setOptions({
    title: 'Resposta espectral por cobertura (' + ANO + ESPECTRO_INICIO + ' a ' + ANO + ESPECTRO_FIM + ')',
    hAxis: {title: 'Comprimento de onda (nm)', titleTextStyle: {italic: false, bold: true}, slantedText: true},
    vAxis: {title: 'Refletância', titleTextStyle: {italic: false, bold: true}},
    lineWidth: 1,
    pointSize: 4
  }));
});

// =====================================================================
// BLOCO 10 - CAMADAS NO MAPA
// =====================================================================
Map.centerObject(area, 7);
var contorno = ee.Image().byte().paint({featureCollection: area, width: 1});
Map.addLayer(contorno, {palette: 'blue'}, 'Contorno RGIs', true);
Map.addLayer(buffers.filter(ee.Filter.eq('classe', 'Seringal')), {color: 'green'}, 'Buffers - seringal', false);
Map.addLayer(buffers.filter(ee.Filter.neq('classe', 'Seringal')), {color: 'red'}, 'Buffers - outras coberturas', false);

// =====================================================================
// BLOCO 11 - LOCALIZADOR DE CANDIDATOS (opcional: MOSTRAR_LOCALIZADOR = true)
// Só ajuda a ACHAR pontos; não entra no cálculo. Use zoom 12 ou mais.
// =====================================================================
if (MOSTRAR_LOCALIZADOR) {
  var paraIndices = function(img){
    var limpa = img.updateMask(img.select('cs_cdf').gte(CS_LIMIAR));
    return ee.Image(limpa.normalizedDifference(['B8', 'B4']).rename('NDVI')
      .addBands(limpa.normalizedDifference(['B8', 'B11']).rename('NDMI'))
      .copyProperties(img, ['system:time_start']));
  };
  var s2Area = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(area)
    .filterDate(ANO + '-01-01', ANO + '-11-01')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', NUVEM_MAX))
    .linkCollection(csPlus, ['cs_cdf'])
    .map(paraIndices);
  var seca = s2Area.filterDate(ANO + '-06-01', ANO + '-09-01').select('NDMI')
    .reduce(ee.Reducer.percentile([10])).rename('NDMI_seca');
  var rebrota = s2Area.filterDate(ANO + '-08-01', ANO + '-11-01')
    .reduce(ee.Reducer.percentile([90])).rename(['NDVI_reb', 'NDMI_reb']);
  var chuva = s2Area.filterDate(ANO + CHUVA_INICIO, ANO + CHUVA_FIM).select('NDVI')
    .reduce(ee.Reducer.percentile([10])).rename('NDVI_chuva');
  var candidato = seca.lte(LIMIARES.NDMI_min)
    .and(rebrota.select('NDVI_reb').gte(LIMIARES.NDVI_max))
    .and(rebrota.select('NDMI_reb').subtract(seca).gte(LIMIARES.NDMI_amp))
    .and(chuva.gte(LIMIARES.NDVI_chuva))
    .selfMask();
  Map.addLayer(candidato, {palette: ['ff00ff']}, 'Candidatos a seringal (localizador)', true);
}
