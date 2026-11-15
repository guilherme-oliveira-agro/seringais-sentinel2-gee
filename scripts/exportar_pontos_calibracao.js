/*
Exporta as coordenadas dos pontos de calibração (Imports do projeto) para um CSV.
Rode no mesmo projeto do GEE do script assinatura_espectral_v3_1.js (onde estão os Imports).
Depois: aba Tasks -> RUN -> o arquivo vai para o Google Drive.
*/
var seringais = grupo_1.merge(grupo_2).merge(grupo_3).merge(grupo_4)
  .map(function(f){ return f.set('classe', 'Seringal'); });
var outras = pivo.merge(cana).merge(pasto).merge(eucalipto).merge(mata);
var pontos = seringais.merge(outras).map(function(f){
  var c = f.geometry().centroid(1).coordinates();
  return ee.Feature(null, {classe: f.get('classe'), Name: f.get('Name'),
                           lon: c.get(0), lat: c.get(1)});
});
print('Pontos de calibração:', pontos.size(), pontos.limit(5));
Export.table.toDrive({
  collection: pontos,
  description: 'pontos_calibracao_coordenadas',
  fileFormat: 'CSV',
  selectors: ['classe', 'Name', 'lat', 'lon']
});
