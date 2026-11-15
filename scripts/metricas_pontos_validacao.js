/*
Métricas fenológicas (2025) nos 50 pontos do estrato seringal da validação
Objetivo: comparar as matas que o mapa confundiu (11 falsos positivos) com os seringais
confirmados (38 verdadeiros positivos) nas mesmas métricas usadas pelas regras.
Usa os assets da Etapa A, com a mesma suavização 3x3 da Etapa B. Leve (poucos minutos).
Saída: metricas_pontos_validacao_2025.csv (pasta TCC_seringais no Google Drive)
*/
var ANO = 2025;
var PASTA_ASSET = 'projects/projeto-01-471014/assets/';
var ESCALA = 20;
var PARTES = ['CampoGrande_1', 'CampoGrande_2', 'CampoGrande_3', 'CampoGrande_4',
              'Uberaba', 'Uberlandia', 'Aracatuba', 'SaoJoseRioPreto', 'RibeiraoPreto'];

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

var metricas = ee.ImageCollection(PARTES.map(function(n){
  return ee.Image(PASTA_ASSET + 'metricas_' + ANO + '_' + n + '_' + ESCALA + 'm');
})).mosaic().divide(10000)
  .convolve(ee.Kernel.square({radius: 1, units: 'pixels', normalize: true}));

var pontos = ee.FeatureCollection(PONTOS.map(function(p){
  return ee.Feature(ee.Geometry.Point([p[1], p[2]]), {name: p[0]});
}));

var tabela = metricas.sampleRegions({collection: pontos, properties: ['name'], scale: ESCALA,
  projection: ee.Projection('EPSG:4326'), geometries: false});
print('Pontos com métricas (deve ser 50):', tabela.size());

Export.table.toDrive({
  collection: tabela,
  description: 'metricas_pontos_validacao_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['name', 'NDVI_min', 'NDVI_max', 'NDVI_amp', 'NDVI_chuva']
});
