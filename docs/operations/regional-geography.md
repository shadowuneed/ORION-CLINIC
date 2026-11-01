# Turkestan geographic reference

Checked on 8 October 2026. This is a locally served geographic reference for the
regional CRM. Operational facility counts, patients, tasks and KPI values come
from PostgreSQL; they are not part of this boundary dataset.

## Administrative structure

The [regional government investment portal](https://turkestan.invest.gov.kz/ru/about/info/)
lists 14 districts and three cities of regional significance: Turkestan, Kentau
and Arys. Sauran is included; its creation is recorded in the
[15 March 2021 presidential decree](https://adilet.zan.kz/rus/docs/U2100000534).
The [Shymkent city administration](https://www.gov.kz/memleket/entities/shymkent/?lang=ru)
confirms Shymkent has republican-city status since 19 June 2018. It is displayed
next to Turkestan units but has `parentId: null` and must not enter the oblast's
17-unit administrative aggregate.

The portal supplies names and hierarchy, not cadastral polygons. Geometry was
retrieved from OpenStreetMap's primary public relation API on
`2026-10-08T12:40:01.147Z` (17:40 in Asia/Qyzylorda). Relations and their versions
are recorded in `public/maps/turkestan-provenance.json`. These are community map
boundaries, not an official cadastral certification.

| ID | Display name | OSM relation |
| --- | --- | --- |
| turkestan-region | Туркестанская область | 215739 |
| sozak | Созакский район | 3407031 |
| sauran | Сауранский район | 3407078 |
| otyrar | Отырарский район | 3407147 |
| maktaaral | Мактааральский район | 3407205 |
| shardara | Шардаринский район | 3407327 |
| arys | Арыс | 3407442 |
| baydibek | Байдибекский район | 3407558 |
| ordabasy | Ордабасинский район | 3407634 |
| kazygurt | Казыгуртский район | 5496171 |
| turkestan | Туркестан | 5496366 |
| sayram | Сайрамский район | 5496738 |
| saryagash | Сарыагашский район | 5497131 |
| tulkibas | Тюлькубасский район | 5498009 |
| tolebi | Толебийский район | 5498152 |
| zhetisay | Жетисайский район | 8768984 |
| kentau | Кентау | 17322798 |
| keles | Келесский район | 9210172 |
| shymkent | Шымкент — отдельный регион | 3389772 |

Fetch the source for an ID with
`https://www.openstreetmap.org/api/0.6/relation/{id}/full.json`.
Do not infer the registry solely from relation 215739's `subarea` list: that
snapshot omits Keles even though relation 9210172 exists and the official list
includes the district. geoBoundaries' current Kazakhstan ADM2 API was evaluated
but rejected because it explicitly represents 2017, before Sauran's creation.

## Geometry processing and files

- `turkestan-districts.geojson`: display collection, 18 named units.
- `turkestan-region.geojson`: the oblast's separate outline and Shymkent hole.
- `turkestan-districts-source.geojson`: generalized OSM topology before the one
  documented enclave correction below; retained for transparent comparison.
- `turkestan-provenance.json`: source relation versions, edit dates, vertex
  counts, retrieval date, license and exact correction explanation.

The conversion joins OSM `outer`/`inner` member ways by exact node IDs and fails
on an open chain or orphan hole. Shared ways are simplified once with
Douglas–Peucker at 0.0006 degrees in a local longitude*cos(43°) projection,
approximately 67 metres. Shared retained vertices and all way endpoints are
reused in every adjacent area. Coordinates are rounded to six decimals. Outer
rings are counterclockwise and holes clockwise; disconnected polygons and all
enclaves are retained. Render SVG using `fillRule="evenodd"`.

`labelPoint` is a computed interior label position. `administrativeCentre` is the
source OSM admin-centre node, with its name. Every one of the 18 centres is inside
its unit. Fixture hospital and polyclinic coordinates offset from these centres
by ±0.010 longitude / ±0.012 latitude were checked: all 36 remain inside their
corresponding unit. These fictional facility positions are not a real-world
hospital register.

The district display file is approximately 170 kB (uncompressed), the optional
oblast outline 40 kB. No browser tile service, map API key, geocoder or external
runtime request is needed. Local files are fetched only when the map opens.

## Source topology correction

The source Arys relation includes a detached exclave (67 retained vertices)
entirely within the source Baydibek polygon. Baydibek lacks the corresponding
inner ring. The original polygons therefore overlap by 0.0607884548% of the
oblast's planar reference area. No substitute border was drawn.

For display, that same unchanged Arys ring is copied with reverse winding into
Baydibek as a hole. Arys stays intact. The correction is declared in the feature
(`derivedTopologyCorrection` and `topologyCorrection`) and provenance metadata;
the source collection remains available. After this repair, cancellation of
every shared directed edge yields exactly the oblast outline, including the
Shymkent hole. The sum of 17 units matches the outline's area to 1e-8 square
degrees. A segment-intersection audit found no ring self-intersections.

This local consistency repair does not certify administrative ownership. Future
updates should inspect the original relations and repeat the tests; never apply
an invented partition or silently reuse a stale pre-Sauran dataset.

## License and verification

Map data © OpenStreetMap contributors. The boundary dataset and its derivative
are distributed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Keep visible linked [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
on the map; the source geometry is available locally alongside its provenance.
This license notice applies to the geographic reference, not medical records.

`pnpm exec vitest run lib/regional/geography.test.ts --no-file-parallelism --maxWorkers=1`
passes seven tests covering current unit counts/IDs, Shymkent separation, closed
rings/winding, exact shared-edge topology, city holes, inside-area centres,
the unchanged exclave correction, attribution and a payload budget.

No database migration, patient read/write, cloud operation or provider request
is performed by the geographic module or its tests.
