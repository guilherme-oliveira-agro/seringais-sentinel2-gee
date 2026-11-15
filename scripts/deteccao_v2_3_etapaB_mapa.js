/*
Rotina para detecção automática de seringais (Sentinel-2/MSI) - versão 2.3 - ETAPA B: MAPA
Lê as métricas calculadas na ETAPA A (assets "metricas_ANO_RGI"), aplica a suavização 3x3,
as 3 regras calibradas (R1, R2, R3), a máscara de formação florestal do MapBiomas (opcional)
e o pós-processamento da rotina original (fechamento + área mínima).
v2.3: USAR_MASCARA_MAPBIOMAS = true gera o mapa final recomendado;
      false reproduz o mapa sem máscara (o avaliado na validação principal).
É leve: pode ser rodada várias vezes, inclusive para testar outros limiares.
*/

// =====================================================================
// BLOCO 1 - PARÂMETROS (só é preciso alterar aqui)
// =====================================================================
var ANO = 2025;
var PASTA_ASSET = 'projects/projeto-01-471014/assets/';

var ESCALA = 20;   // a mesma usada na ETAPA A (10 ou 20 m)

// Limiares calibrados para 2025 (script de assinatura v3.1 + conferência visual)
var LIMIARES = {
  NDVI_amp: 0.25,    // R1: amplitude do NDVI >= 0,25      (original: 0,20)
  NDVI_max: 0.85,    // R2: NDVI máximo pós-rebrota >= 0,85 (original: 0,60)
  NDVI_chuva: 0.60   // R3: NDVI na chuva (p10 jan-abr) >= 0,60 (regra nova: exclui pivô central)
};

// Pós-processamento (mantido da rotina original)
var RAIO_FECHAMENTO_M = 20;  // raio do fechamento morfológico em metros (original: 2 pixels de 10 m)
var AREA_MINIMA_HA = 5;      // área mínima de um seringal (ha) = 50.000 m²

// Máscara do MapBiomas: retira os pixels de formação florestal (classe 3) antes do pós-processamento
var USAR_MASCARA_MAPBIOMAS = true;  // true = mapa final recomendado | false = mapa sem máscara
var CLASSES_MASCARA = [3];          // 3 = formação florestal (a silvicultura, classe 9, NÃO é retirada)
var SUFIXO = USAR_MASCARA_MAPBIOMAS ? '_mb' : '';  // nomes diferentes para não sobrescrever o mapa sem máscara

var EXPORTAR_GEOTIFF = true;    // true = também gera GeoTIFF no Google Drive (para mapas no QGIS)

// Nomes dos assets de métricas da ETAPA A (Campo Grande em 4 partes).
// Enquanto a ETAPA A não terminar, deixe na lista só os que já estão prontos.
var PARTES = ['Aracatuba', 'RibeiraoPreto', 'Uberlandia', 'Uberaba', 'SaoJoseRioPreto',
              'CampoGrande_1', 'CampoGrande_2', 'CampoGrande_3', 'CampoGrande_4'];

// =====================================================================
// BLOCO 2 - ÁREA DE ESTUDO E MÉTRICAS DA ETAPA A
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

// Junta as métricas das 6 RGIs e volta à escala do NDVI (÷ 10.000)
var metricasBrutas = ee.ImageCollection(PARTES.map(function(n){
  return ee.Image(PASTA_ASSET + 'metricas_' + ANO + '_' + n + '_' + ESCALA + 'm');
})).mosaic().divide(10000);

// Suavização 3x3 (mantida da rotina original): reduz o ruído pixel a pixel
var kernel3x3 = ee.Kernel.square({radius: 1, units: 'pixels', normalize: true});
var metricas = metricasBrutas.convolve(kernel3x3);

// =====================================================================
// BLOCO 3 - REGRAS DE DECISÃO (o pixel precisa passar nas 3)
// =====================================================================
var candidato = metricas.select('NDVI_amp').gte(LIMIARES.NDVI_amp)           // R1
  .and(metricas.select('NDVI_max').gte(LIMIARES.NDVI_max))                   // R2
  .and(metricas.select('NDVI_chuva').gte(LIMIARES.NDVI_chuva))               // R3
  .unmask(0).rename('seringal');

// Máscara do MapBiomas (coleção mais recente do catálogo do GEE; ano = ANO ou o último disponível)
if (USAR_MASCARA_MAPBIOMAS) {
  var MB = ee.ImageCollection('projects/mapbiomas-public/assets/brazil/lulc/v1');
  var colecao = MB.aggregate_max('collection_id');
  var MBc = MB.filter(ee.Filter.eq('collection_id', colecao));
  var versao = ee.List(MBc.aggregate_array('version')).distinct().sort().get(-1);
  MBc = MBc.filter(ee.Filter.eq('version', versao));
  var anoMB = ee.Number(MBc.aggregate_max('year')).min(ANO);
  var lulc = MBc.filter(ee.Filter.eq('year', anoMB)).mosaic().select(0);
  print('MapBiomas usado -> coleção:', colecao, 'versão:', versao, 'ano:', anoMB);
  var nativa = lulc.remap(CLASSES_MASCARA, CLASSES_MASCARA.map(function(){ return 1; }), 0).unmask(0);
  candidato = candidato.and(nativa.not()).rename('seringal');
}
candidato = candidato.reproject({crs: 'EPSG:4326', scale: ESCALA});   // fixa a escala (o mapa interativo não "afina" o filtro de área)

// =====================================================================
// BLOCO 4 - PÓS-PROCESSAMENTO (mantido da rotina original)
// =====================================================================
// Fechamento morfológico: dilatação + erosão -> preenche buracos dentro dos talhões
var kernel = ee.Kernel.circle({radius: RAIO_FECHAMENTO_M, units: 'meters'});
var fechado = candidato.focal_max({kernel: kernel}).focal_min({kernel: kernel});

// Área mínima: remove manchas menores que AREA_MINIMA_HA (5 ha = 500 pixels de 10 m ou 125 de 20 m)
var pixelsMinimos = AREA_MINIMA_HA * 10000 / (ESCALA * ESCALA);
var tamanhoMancha = fechado.selfMask().connectedPixelCount({maxSize: 1024, eightConnected: true});
var seringais = fechado.updateMask(tamanhoMancha.gte(pixelsMinimos))
  .selfMask().rename('seringal').toByte();

// Camadas para conferência: DESLIGADAS. Aproxime (zoom >= 11) numa área conhecida e só então ligue
var cores = ['c0772c', 'ff9e3a', 'fdff78', 'ccff00', '44e700', '087800', '043100'];
Map.addLayer(metricas.select('NDVI_amp'), {min: 0, max: 0.7, palette: cores}, 'Amplitude NDVI', false);
Map.addLayer(metricas.select('NDVI_chuva'), {min: 0.2, max: 0.9, palette: cores}, 'NDVI na chuva', false);
Map.addLayer(candidato.selfMask(), {palette: ['ff00ff']}, 'Candidatos (antes do pós-processamento)', false);
Map.addLayer(seringais, {palette: ['ff0000']}, 'Seringais detectados (final)', false);  // ligue só com zoom >= 11

// =====================================================================
// BLOCO 5 - EXPORTAÇÃO DO MAPA FINAL (uma tarefa por RGI) - aba Tasks -> RUN
// =====================================================================
regioes.forEach(function(r){
  var imagem = seringais.clipToCollection(r.fc);
  var regiao = r.fc.geometry().bounds();

  // Asset: usado na validação e no cálculo de área
  Export.image.toAsset({
    image: imagem,
    description: 'seringais_' + ANO + '_' + r.nome + SUFIXO,
    assetId: PASTA_ASSET + 'seringais_' + ANO + '_' + r.nome + SUFIXO,
    region: regiao,
    scale: ESCALA,
    crs: 'EPSG:4326',
    maxPixels: 1e11,
    pyramidingPolicy: {seringal: 'mode'}
  });

  // GeoTIFF no Drive (opcional, para mapas no QGIS)
  if (EXPORTAR_GEOTIFF) {
    Export.image.toDrive({
      image: imagem,
      description: 'seringais_' + ANO + '_' + r.nome + SUFIXO + '_tif',
      folder: 'TCC_seringais',
      region: regiao,
      scale: ESCALA,
      crs: 'EPSG:4326',
      maxPixels: 1e11,
      fileFormat: 'GeoTIFF',
      formatOptions: {cloudOptimized: true}
    });
  }
});
