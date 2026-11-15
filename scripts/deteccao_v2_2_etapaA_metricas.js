/*
Rotina para detecção automática de seringais (Sentinel-2/MSI) - versão 2.2 - ETAPA A: MÉTRICAS (mais leve)
Calcula, pixel a pixel, as 4 métricas fenológicas e salva como asset (uma tarefa por RGI).
É a parte pesada: roda uma vez só. As regras e o pós-processamento ficam na ETAPA B (leve).
Base: rotina original do orientador (amplitude do NDVI entre desfolha e reenfolhamento,
suavização 3x3, fechamento morfológico e área mínima de 5 ha).
Alterações: máscara Cloud Score+, compostos por decêndio, máximo procurado até 70 dias
após o mínimo de cada pixel, regra de estabilidade na chuva (pivô) e limiares calibrados
no script de assinatura v3.1 (16 seringais x 25 pontos de outras coberturas, 2024 e 2025).
v2.2: mesma lógica da v2.1, com menor consumo de cota do GEE:
  - só as bandas B4, B8 e cs_cdf são lidas;
  - só os meses usados pelas métricas (jan-abr e jun-nov);
  - resolução de saída ajustável (ESCALA): 20 m custa cerca de 4x menos que 10 m.
*/

// =====================================================================
// BLOCO 1 - PARÂMETROS (só é preciso alterar aqui)
// =====================================================================
var ANO = 2025;
var NUVEM_MAX = 60;          // % máxima de nuvem da cena (original: 1%)
var CS_LIMIAR = 0.60;        // Cloud Score+: pixel limpo se cs_cdf >= 0,60
var ESCALA = 20;             // resolução das métricas (m): 10 = máximo detalhe; 20 = ~4x menos processamento

// Janelas fenológicas (mês-dia) - as mesmas da calibração
var MIN_INICIO = '-06-01', MIN_FIM = '-09-01';     // MÍNIMO (desfolha): jun a ago (original: 01/07 a 10/08)
var DIAS_APOS_MIN = 70;                            // MÁXIMO: até 70 dias após o mínimo (original: 15/08 a 30/09)
var CHUVA_INICIO = '-01-01', CHUVA_FIM = '-05-01'; // copa cheia (chuva): jan a abr (regra nova)

// Exportação
var PASTA_ASSET = 'projects/projeto-01-471014/assets/';

// =====================================================================
// BLOCO 2 - ÁREA DE ESTUDO
// =====================================================================
var regioes = [
  {nome: 'CampoGrande', fc: rgi_cg},
  {nome: 'Uberaba', fc: rgi_uba},
  {nome: 'Uberlandia', fc: rgi_udi},
  {nome: 'Aracatuba', fc: rgi_ara},
  {nome: 'SaoJoseRioPreto', fc: rgi_sjp},
  {nome: 'RibeiraoPreto', fc: rgi_rp}
];
var area = rgi_cg.merge(rgi_uba).merge(rgi_udi).merge(rgi_ara).merge(rgi_sjp).merge(rgi_rp);

Map.centerObject(area, 7);
var contorno = ee.Image().byte().paint({featureCollection: area, width: 2});
Map.addLayer(contorno, {palette: 'blue'}, 'Contorno RGIs', true);

// =====================================================================
// BLOCO 3 - COLEÇÃO SENTINEL-2 COM MÁSCARA DE NUVENS CLOUD SCORE+
// =====================================================================
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

var colecao = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(area)
  .filter(ee.Filter.or(
    ee.Filter.date(ANO + '-01-01', ANO + '-05-01'),   // jan-abr: NDVI na chuva
    ee.Filter.date(ANO + '-06-01', ANO + '-12-01')))  // jun-nov: mínimo + até 70 dias depois
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', NUVEM_MAX))
  .select(['B4', 'B8'])
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function(img){
    return img.updateMask(img.select('cs_cdf').gte(CS_LIMIAR)).select(['B4', 'B8']);
  });

print('Imagens Sentinel-2 utilizadas em ' + ANO + ':', colecao.size());

// =====================================================================
// BLOCO 4 - NDVI E COMPOSTOS POR DECÊNDIO (mediana)
// =====================================================================
var colecao_NDVI = colecao.map(function(img){
  return ee.Image(img.normalizedDifference(['B8', 'B4']).rename('NDVI').float()
    .copyProperties(img, ['system:time_start']));
});

var imagemVazia = ee.Image.constant(0).rename('NDVI').float().updateMask(0);

function composto(col, inicio, fim){
  var sub = col.filterDate(inicio, fim);
  return ee.Image(ee.Algorithms.If(sub.size().gt(0), sub.median(), imagemVazia))
    .set('system:time_start', inicio.millis());
}

function agregaDecendios(col, ano){
  var meses = ee.List.sequence(1, 12);
  return ee.ImageCollection.fromImages(meses.map(function(m){
    var inicioMes = ee.Date.fromYMD(ano, m, 1);
    var dia11 = inicioMes.advance(10, 'day');
    var dia21 = inicioMes.advance(20, 'day');
    var fimMes = inicioMes.advance(1, 'month');
    return [composto(col, inicioMes, dia11), composto(col, dia11, dia21), composto(col, dia21, fimMes)];
  }).flatten());
}

var colecao_decendial = agregaDecendios(colecao_NDVI, ANO);

// =====================================================================
// BLOCO 5 - MÉTRICAS FENOLÓGICAS (iguais às da calibração)
// =====================================================================
var comDia = colecao_decendial.map(function(img){
  var v = img.select('NDVI');
  var dia = ee.Date(img.get('system:time_start')).getRelative('day', 'year').add(1);
  return v.addBands(ee.Image.constant(dia).float().rename('DIA'))
          .addBands(v.multiply(-1).rename('INVERSO'))
          .updateMask(v.mask());
});

// 1) MÍNIMO na janela de desfolha
var minimo = comDia.filterDate(ANO + MIN_INICIO, ANO + MIN_FIM)
  .qualityMosaic('INVERSO').select(['NDVI', 'DIA'], ['NDVI_min', 'DIA_min']);
var diaMin = minimo.select('DIA_min');

// 2) MÁXIMO até DIAS_APOS_MIN dias depois do mínimo (em cada pixel)
var maximo = comDia.map(function(img){
    var d = img.select('DIA');
    return img.updateMask(d.gt(diaMin).and(d.lte(diaMin.add(DIAS_APOS_MIN))));
  })
  .qualityMosaic('NDVI').select(['NDVI'], ['NDVI_max']);

// 3) AMPLITUDE e 4) ESTABILIDADE NA CHUVA
var amplitude = maximo.subtract(minimo.select('NDVI_min')).rename('NDVI_amp');
var chuva = colecao_decendial.filterDate(ANO + CHUVA_INICIO, ANO + CHUVA_FIM)
  .select('NDVI').reduce(ee.Reducer.percentile([10])).rename('NDVI_chuva');

// Junta as 4 métricas e guarda como número inteiro (x 10.000) para ocupar menos espaço
var metricas = minimo.select('NDVI_min').addBands(maximo).addBands(amplitude).addBands(chuva)
  .multiply(10000).round().toInt16();

// =====================================================================
// BLOCO 6 - EXPORTAÇÃO DAS MÉTRICAS - aba Tasks -> RUN em cada tarefa
// Campo Grande é dividida em 4 retângulos (é mais da metade da área de estudo)
// =====================================================================
function exporta(imagem, nome, regiao){
  Export.image.toAsset({
    image: imagem,
    description: 'metricas_' + ANO + '_' + nome + '_' + ESCALA + 'm',
    assetId: PASTA_ASSET + 'metricas_' + ANO + '_' + nome + '_' + ESCALA + 'm',
    region: regiao,
    scale: ESCALA,
    crs: 'EPSG:4326',
    maxPixels: 1e11,
    pyramidingPolicy: {'.default': 'mean'}
  });
}

regioes.filter(function(r){ return r.nome !== 'CampoGrande'; }).forEach(function(r){
  exporta(metricas.clipToCollection(r.fc), r.nome, r.fc.geometry().bounds());
});

var partesCG = [
  {nome: 'CampoGrande_1', ret: ee.Geometry.Rectangle([-55.7, -19.7, -53.25, -17.1])},
  {nome: 'CampoGrande_2', ret: ee.Geometry.Rectangle([-53.25, -19.7, -50.8, -17.1])},
  {nome: 'CampoGrande_3', ret: ee.Geometry.Rectangle([-55.7, -22.2, -53.25, -19.7])},
  {nome: 'CampoGrande_4', ret: ee.Geometry.Rectangle([-53.25, -22.2, -50.8, -19.7])}
];
partesCG.forEach(function(p){
  exporta(metricas.clipToCollection(rgi_cg).clip(p.ret), p.nome, p.ret);
});
