/*
Rotina de VALIDAÇÃO COMPLEMENTAR - máscara florestal do MapBiomas (teste)
Objetivo: verificar se retirar do mapa os pixels que o MapBiomas classifica como vegetação
nativa reduz os falsos positivos em mata, sem perder seringais verdadeiros.

Como funciona (mesma Etapa B do mapa de 2025, com 1 passo a mais):
  regras R1 + R2 + R3  ->  [NOVO] retira os pixels da máscara do MapBiomas  ->
  fechamento morfológico  ->  área mínima de 5 ha
São testadas 2 variantes de máscara:
  A = só formação florestal (classe 3)
  B = formação florestal + formação savânica (classes 3 e 4)
A silvicultura (classe 9) NÃO é retirada, porque parte dos seringais está nela.

Por que os mesmos pontos servem: a máscara só RETIRA pixels, então o novo mapa fica
dentro do antigo. Os 150 pontos de "outras coberturas" continuam fora do seringal,
e só os 50 pontos do estrato seringal podem mudar de classe. Por isso, aqui entram
apenas esses 50 pontos (sorteio original, semente 2025).

Saídas (pasta TCC_seringais no Google Drive):
  1) validacao_mapbiomas_pontos_2025.csv -> classe de cada um dos 50 pontos nas variantes A e B
                                           e a classe do MapBiomas no ponto (leve, poucos minutos)
  2) validacao_mapbiomas_areas_2025.csv  -> nova área mapeada por RGI nas variantes A e B (mais pesada)
*/

// =====================================================================
// BLOCO 1 - PARÂMETROS
// =====================================================================
var ANO = 2025;
var PASTA_ASSET = 'projects/projeto-01-471014/assets/';
var ESCALA = 20;
var LIMIARES = {NDVI_amp: 0.25, NDVI_max: 0.85, NDVI_chuva: 0.60};   // R1, R2, R3 (iguais ao mapa de 2025)
var RAIO_FECHAMENTO_M = 20;
var AREA_MINIMA_HA = 5;
var MASCARA_A = [3];      // formação florestal
var MASCARA_B = [3, 4];   // formação florestal + formação savânica

var PARTES = [
  {n: 'CampoGrande_1', c: 1}, {n: 'CampoGrande_2', c: 1}, {n: 'CampoGrande_3', c: 1}, {n: 'CampoGrande_4', c: 1},
  {n: 'Uberaba', c: 2}, {n: 'Uberlandia', c: 3}, {n: 'Aracatuba', c: 4},
  {n: 'SaoJoseRioPreto', c: 5}, {n: 'RibeiraoPreto', c: 6}
];
var RGIS = ['CampoGrande', 'Uberaba', 'Uberlandia', 'Aracatuba', 'SaoJoseRioPreto', 'RibeiraoPreto'];
var CAIXA = ee.Geometry.Rectangle([-56.0, -23.0, -45.5, -16.5]);

// 50 pontos do estrato "seringal" do sorteio original [nome, longitude, latitude]
var PONTOS = [
  ['P006', -49.061040, -20.889334], ['P009', -50.918576, -21.190269],
  ['P010', -48.777711, -20.454729], ['P012', -49.649437, -20.548513],
  ['P015', -49.972830, -20.048870], ['P016', -49.400244, -19.608516],
  ['P017', -50.912288, -20.139959], ['P018', -49.491333, -20.515814],
  ['P023', -50.018824, -20.654694], ['P025', -52.587646, -21.890596],
  ['P028', -50.274844, -20.628463], ['P040', -49.948755, -20.334534],
  ['P043', -49.068047, -20.865259], ['P049', -47.299444, -21.542768],
  ['P059', -48.857662, -20.728356], ['P060', -50.983255, -20.206255],
  ['P061', -51.938883, -20.405860], ['P062', -50.844196, -20.341721],
  ['P066', -51.909059, -19.051381], ['P070', -49.650335, -19.953649],
  ['P073', -50.023136, -20.356453], ['P076', -49.207286, -20.687931],
  ['P082', -50.074160, -20.786926], ['P083', -49.145482, -19.905319],
  ['P085', -49.423600, -21.154876], ['P087', -47.432035, -19.432446],
  ['P091', -50.424144, -19.824830], ['P098', -49.887310, -21.017074],
  ['P113', -54.401345, -20.222784], ['P114', -51.906903, -19.054615],
  ['P119', -50.428995, -20.648765], ['P126', -50.902946, -20.819984],
  ['P128', -50.442829, -20.184516], ['P129', -49.625721, -21.226202],
  ['P137', -51.176393, -20.040606], ['P150', -51.257960, -20.201763],
  ['P159', -50.115303, -19.669062], ['P160', -49.559246, -20.934609],
  ['P161', -49.542537, -20.534140], ['P165', -50.494212, -21.135113],
  ['P169', -49.375450, -19.623069], ['P174', -54.837207, -18.021372],
  ['P178', -48.609008, -20.360226], ['P185', -50.719150, -20.715779],
  ['P187', -50.754724, -21.178771], ['P193', -49.630752, -20.068453],
  ['P196', -48.945517, -21.298247], ['P198', -53.165263, -18.446096],
  ['P199', -54.605981, -17.817994], ['P200', -48.612062, -20.365077]
];

// =====================================================================
// BLOCO 2 - MAPBIOMAS (coleção mais recente no catálogo do GEE; ano = ANO ou o último disponível)
// =====================================================================
var MB = ee.ImageCollection('projects/mapbiomas-public/assets/brazil/lulc/v1');
var colecao = MB.aggregate_max('collection_id');
var MBc = MB.filter(ee.Filter.eq('collection_id', colecao));
var versao = ee.List(MBc.aggregate_array('version')).distinct().sort().get(-1);
MBc = MBc.filter(ee.Filter.eq('version', versao));
var anoMB = ee.Number(MBc.aggregate_max('year')).min(ANO);
var lulc = MBc.filter(ee.Filter.eq('year', anoMB)).mosaic().select(0).rename('mb_classe');
print('MapBiomas usado -> coleção:', colecao, 'versão:', versao, 'ano:', anoMB);

// =====================================================================
// BLOCO 3 - MÉTRICAS DA ETAPA A, SUAVIZAÇÃO E REGRAS (igual à Etapa B)
// =====================================================================
var metricas = ee.ImageCollection(PARTES.map(function(p){
  return ee.Image(PASTA_ASSET + 'metricas_' + ANO + '_' + p.n + '_' + ESCALA + 'm');
})).mosaic().divide(10000)
  .convolve(ee.Kernel.square({radius: 1, units: 'pixels', normalize: true}));

var candidato = metricas.select('NDVI_amp').gte(LIMIARES.NDVI_amp)        // R1
  .and(metricas.select('NDVI_max').gte(LIMIARES.NDVI_max))                // R2
  .and(metricas.select('NDVI_chuva').gte(LIMIARES.NDVI_chuva))            // R3
  .unmask(0);

var kernel = ee.Kernel.circle({radius: RAIO_FECHAMENTO_M, units: 'meters'});
var pixelsMinimos = AREA_MINIMA_HA * 10000 / (ESCALA * ESCALA);

// Mapa com a máscara: retira as classes do MapBiomas ANTES do pós-processamento
function mapaComMascara(classes, nome) {
  var nativa = lulc.remap(classes, classes.map(function(){ return 1; }), 0).unmask(0);
  var c = candidato.and(nativa.not())
    .reproject({crs: 'EPSG:4326', scale: ESCALA});
  var fechado = c.focal_max({kernel: kernel}).focal_min({kernel: kernel});
  var mancha = fechado.selfMask().connectedPixelCount({maxSize: 1024, eightConnected: true});
  return fechado.updateMask(mancha.gte(pixelsMinimos)).unmask(0).toByte().rename(nome);
}
var mapaA = mapaComMascara(MASCARA_A, 'classe_A');
var mapaB = mapaComMascara(MASCARA_B, 'classe_B');

// Mapa original (assets da Etapa B), para conferência: os 50 pontos devem ter classe 1
var original = ee.ImageCollection(RGIS.map(function(r){
  return ee.Image(PASTA_ASSET + 'seringais_' + ANO + '_' + r).unmask(0);
})).max().toByte().rename('classe_original');

// Código da RGI (1 Campo Grande, 2 Uberaba, 3 Uberlândia, 4 Araçatuba, 5 S. J. Rio Preto, 6 Ribeirão Preto)
var rgiImg = ee.ImageCollection(PARTES.map(function(p){
  var dentro = ee.Image(PASTA_ASSET + 'metricas_' + ANO + '_' + p.n + '_' + ESCALA + 'm').select(0).mask().gt(0);
  return ee.Image.constant(p.c).toByte().updateMask(dentro).rename('rgi');
})).mosaic();

// Visualização (ligue com zoom >= 11)
Map.addLayer(original.selfMask(), {palette: ['ff0000']}, 'Mapa original', false);
Map.addLayer(mapaA.selfMask(), {palette: ['00ffff']}, 'Variante A (sem formação florestal)', false);
Map.addLayer(mapaB.selfMask(), {palette: ['0000ff']}, 'Variante B (sem florestal e savânica)', false);

// =====================================================================
// BLOCO 4 - SAÍDA 1: CLASSE DOS 50 PONTOS (leve)
// =====================================================================
var pontos = ee.FeatureCollection(PONTOS.map(function(p){
  return ee.Feature(ee.Geometry.Point([p[1], p[2]]), {name: p[0]});
}));
var tabelaPontos = original.addBands(mapaA).addBands(mapaB).addBands(lulc).addBands(rgiImg)
  .sampleRegions({collection: pontos, properties: ['name'], scale: ESCALA,
                  projection: ee.Projection('EPSG:4326'), geometries: false});
print('Conferência (deve ser 50 pontos com classe_original = 1):', tabelaPontos.aggregate_histogram('classe_original'));

Export.table.toDrive({
  collection: tabelaPontos,
  description: 'validacao_mapbiomas_pontos_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['name', 'rgi', 'classe_original', 'classe_A', 'classe_B', 'mb_classe']
});

// =====================================================================
// BLOCO 5 - SAÍDA 2: NOVA ÁREA MAPEADA POR RGI (mais pesada)
// =====================================================================
var ha = ee.Image.pixelArea().divide(10000);
var imgArea = ha.multiply(mapaA).rename('area_A_ha')
  .addBands(ha.multiply(mapaB).rename('area_B_ha'))
  .addBands(rgiImg)
  .updateMask(rgiImg.mask());
var grupos = ee.List(imgArea.reduceRegion({
  reducer: ee.Reducer.sum().repeat(2).group({groupField: 2, groupName: 'codigo'}),
  geometry: CAIXA, scale: ESCALA, crs: 'EPSG:4326', maxPixels: 1e13, tileScale: 4
}).get('groups'));
var areas = ee.FeatureCollection(grupos.map(function(g){
  g = ee.Dictionary(g);
  var s = ee.List(g.get('sum'));
  return ee.Feature(null, {codigo: g.get('codigo'), area_A_ha: s.get(0), area_B_ha: s.get(1)});
}));

Export.table.toDrive({
  collection: areas,
  description: 'validacao_mapbiomas_areas_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['codigo', 'area_A_ha', 'area_B_ha']
});

print('Na aba Tasks, dê RUN nas 2 tarefas. A de pontos termina antes; pode me mandar já.');
