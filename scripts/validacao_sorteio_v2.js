/*
Rotina de VALIDAÇÃO do mapa de seringais - etapa 1: sorteio dos pontos
Amostragem aleatória estratificada pelo mapa (Olofsson et al., 2014):
sorteia N pontos dentro da classe "seringal" e N dentro de "outros".
Gera: (1) KML "cego" para rotular no Google Earth Pro (sem a classe do mapa),
      (2) planilha para preencher a referência, (3) gabarito com a classe do mapa,
      (4) tabela de áreas por RGI (para estimar a área com intervalo de confiança).
Rodar SOMENTE depois que os 6 assets da detecção estiverem prontos.
*/

// =====================================================================
// BLOCO 1 - PARÂMETROS
// =====================================================================
var ANO = 2025;
var PASTA_ASSET = 'projects/projeto-01-471014/assets/';
var N_SERINGAL = 50;     // pontos sorteados dentro do que o mapa chama de seringal
var N_OUTROS = 150;      // pontos sorteados no restante da área
var SEMENTE = 2025;      // garante que o sorteio é sempre o mesmo (reprodutível)
var ESCALA = 20;         // a mesma da detecção (10 ou 20 m)

// =====================================================================
// BLOCO 2 - ÁREA E MAPA DE SERINGAIS (junta os 6 assets)
// =====================================================================
var regioes = [
  {nome: 'CampoGrande', codigo: 1, fc: rgi_cg},
  {nome: 'Uberaba', codigo: 2, fc: rgi_uba},
  {nome: 'Uberlandia', codigo: 3, fc: rgi_udi},
  {nome: 'Aracatuba', codigo: 4, fc: rgi_ara},
  {nome: 'SaoJoseRioPreto', codigo: 5, fc: rgi_sjp},
  {nome: 'RibeiraoPreto', codigo: 6, fc: rgi_rp}
];
var area = rgi_cg.merge(rgi_uba).merge(rgi_udi).merge(rgi_ara).merge(rgi_sjp).merge(rgi_rp);

// Uma feição por RGI, com nome e código
var rgis = ee.FeatureCollection(regioes.map(function(r){
  return ee.Feature(r.fc.geometry(), {RGI: r.nome, codigo: r.codigo});
}));

// Mapa: 1 = seringal, 0 = outros (dentro das RGIs)
var mapa = ee.ImageCollection(regioes.map(function(r){
    return ee.Image(PASTA_ASSET + 'seringais_' + ANO + '_' + r.nome).unmask(0);
  })).max().clipToCollection(area).rename('classe_mapa').toByte();

// Código da RGI de cada pixel (para saber de qual região é cada ponto)
var imagemRGI = ee.Image().byte().paint(rgis, 'codigo').rename('rgi');

Map.centerObject(area, 7);
Map.addLayer(mapa.selfMask(), {palette: ['ff0000']}, 'Seringais (mapa)', false);

// =====================================================================
// BLOCO 3 - SORTEIO ESTRATIFICADO
// =====================================================================
var amostra = mapa.addBands(imagemRGI).stratifiedSample({
  numPoints: 0,
  classBand: 'classe_mapa',
  classValues: [1, 0],
  classPoints: [N_SERINGAL, N_OUTROS],
  region: area.geometry(),
  scale: ESCALA,
  seed: SEMENTE,
  geometries: true,
  tileScale: 16,
  dropNulls: true
});

// Embaralha (para as classes não ficarem em sequência) e numera de 1 a N
var embaralhada = amostra.randomColumn('ordem', SEMENTE).sort('ordem');
var lista = embaralhada.toList(embaralhada.size());
var pontos = ee.FeatureCollection(ee.List.sequence(0, embaralhada.size().subtract(1)).map(function(i){
  var f = ee.Feature(lista.get(i));
  var c = f.geometry().coordinates();
  var id = ee.Number(i).add(1).toInt();
  return f.set({id: id, name: ee.String('P').cat(id.format('%03d')), lon: c.get(0), lat: c.get(1)});
}));

Map.addLayer(pontos, {color: 'yellow'}, 'Pontos de validação', false);

// =====================================================================
// BLOCO 4 - EXPORTAÇÕES (aba Tasks -> RUN em cada uma)
// =====================================================================
// (1) KML "cego": só o número do ponto (P001, P002...) - abrir no Google Earth Pro
Export.table.toDrive({
  collection: pontos.select(['name']),
  description: 'validacao_pontos_cegos_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'KML'
});

// (2) Planilha para rotular: preencha a coluna "referencia" (1 = seringal, 0 = outro)
Export.table.toDrive({
  collection: pontos.map(function(f){ return f.set('referencia', '').set('observacao', ''); }),
  description: 'validacao_planilha_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['name', 'lat', 'lon', 'referencia', 'observacao']
});

// (3) Gabarito: classe do mapa de cada ponto - NÃO abrir antes de terminar a rotulagem
Export.table.toDrive({
  collection: pontos,
  description: 'validacao_gabarito_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['name', 'classe_mapa', 'rgi', 'lat', 'lon']
});

// (4) Áreas por RGI: área total e área mapeada como seringal (ha)
var imagemArea = ee.Image.pixelArea().divide(10000).rename('area_total_ha')
  .addBands(ee.Image.pixelArea().divide(10000).multiply(mapa).rename('area_seringal_ha'));
var areas = imagemArea.reduceRegions({
  collection: rgis,
  reducer: ee.Reducer.sum(),
  scale: ESCALA,
  tileScale: 16
});
Export.table.toDrive({
  collection: areas,
  description: 'validacao_areas_' + ANO,
  folder: 'TCC_seringais',
  fileFormat: 'CSV',
  selectors: ['RGI', 'codigo', 'area_total_ha', 'area_seringal_ha']
});
