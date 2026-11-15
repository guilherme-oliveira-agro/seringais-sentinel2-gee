# Dados

## `rgis.geojson`

Limites das 6 Regiões Geográficas Intermediárias (IBGE, 2017), com as colunas `RGI`, `codigo` e `variavel` (nome usado nos scripts).

## `calibracao/` — 41 pontos (16 seringais + 5 de cada outra cobertura)

| Arquivo | Conteúdo |
|---|---|
| `metricas_pontos_calibracao_2024.csv` / `_2025.csv` | métricas fenológicas de cada ponto: NDVI e NDMI mínimo, máximo (com as datas) e amplitude, e NDVI na chuva |
| `series_decendiais_2024.csv` / `_2025.csv` | série de NDVI e NDMI por decêndio de cada ponto (vazio = sem imagem limpa) |
| `espectro_medio_julho_2024.csv` / `_2025.csv` | refletância média de cada cobertura, por banda, de 15 a 31 de julho |
| `pontos_calibracao.csv` | coordenadas e grupo de cada ponto (`grupo_1`…`grupo_4`, `pivo`, `cana`, `pasto`, `eucalipto`, `mata`) |

## `validacao/` — 200 pontos do sorteio estratificado (semente 2025)

| Arquivo | Conteúdo |
|---|---|
| `pontos_validacao_rotulados_2025.csv` | ponto, classe no mapa, RGI, coordenadas, rótulo da interpretação visual e resultado |
| `areas_por_rgi_2025.csv` | área total e área mapeada como seringal em cada RGI (pesos dos estratos) |
| `metricas_pontos_validacao_2025.csv` | métricas dos 50 pontos do estrato seringal |
| `mapbiomas_pontos_2025.csv` | classe dos 50 pontos no mapa original e com as máscaras A e B |
| `mapbiomas_areas_2025.csv` | área mapeada por RGI com as máscaras A e B |

## Códigos usados nas colunas

| Coluna | Valores |
|---|---|
| `classe_mapa`, `ref`, `classe_*` | 1 = seringal; 0 = não seringal |
| `rgi`, `codigo` | 1 Campo Grande; 2 Uberaba; 3 Uberlândia; 4 Araçatuba; 5 São José do Rio Preto; 6 Ribeirão Preto |
| `c` | VP = verdadeiro positivo; VN = verdadeiro negativo; FPm = falso positivo em mata; FPp = falso positivo em pivô central |
| `mb_classe` | classe do MapBiomas Coleção 11 no ponto (3 formação florestal; 9 silvicultura; 21 mosaico de usos; 41 outras lavouras temporárias; 46 café) |
| máscara A / B | A = retira formação florestal (3); B = retira formação florestal e savânica (3 e 4) |

Coordenadas em graus decimais (WGS 84). Licença: CC BY 4.0 (citar o trabalho).
