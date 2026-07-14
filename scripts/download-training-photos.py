# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests",
#     "Pillow",
# ]
# ///
"""One-off curation script: build the offline training photo pool.

Downloads CC-licensed scene photos from Wikimedia Commons, matched to the
incident types on the board, and writes them (resized, re-encoded, EXIF
stripped) to backend/app/assets/training_photos/<incident_type>/NN.jpg plus
an ATTRIBUTION.md with author/license/source for every image.

Run once at dev time with:  uv run scripts/download-training-photos.py
Never runs at runtime — the app only reads the committed pool.
"""

import io
import re
import sys
import time
from pathlib import Path

import requests
from PIL import Image

API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "kp-rueck-training-photo-curation/1.0 (one-off dev script; https://github.com/kp-rueck)"

REPO_ROOT = Path(__file__).resolve().parent.parent
POOL_DIR = REPO_ROOT / "backend" / "app" / "assets" / "training_photos"

TARGET_PER_TYPE = 8  # aim 6-10 per incident type
MAX_PER_TERM = 4  # variety: don't fill a pool from a single search (same-scene series)
MIN_WIDTH = 800  # skip small originals
MAX_EDGE = 1280  # resize longest edge
JPEG_QUALITY = 80

# Incident types (see valid_incident_type in backend/app/models.py) mapped to
# Commons search terms. Every board type has its own pool; if a type's
# directory is ever emptied, the runtime falls back to a sibling pool
# (alias map in backend/app/services/training_photos.py).
#
# Curation criterion (product owner): photos show the emergency AS THE REKO
# CREW FIRST FINDS IT — the raw scene BEFORE any response. No firefighters,
# fire trucks, police, ambulances, hoses, cordons, warning triangles/signs,
# hi-vis personnel or any responder equipment on scene. Queries are therefore
# scene-only; anything with responders that slips through goes to
# EXCLUDE_TITLES during visual review.
#
# Types WITHOUT an own pool (on purpose):
#   - dienstleistungen: a Dienstleistung IS the response (water supply,
#     traffic service) — there is no scene-before-response imagery for it.
#     The runtime alias serves technische_hilfeleistung.
#   - gerettete_menschen: scene-before-response imagery for person rescues
#     barely exists on Commons (and faces are a problem). Alias falls back
#     to strassenrettung.
#   - chemiewehr: Commons only has hazmat crews/exercises; the two compliant
#     scene-only finds were too few to ship (constant repetition). No alias —
#     chemiewehr reports simply carry no photos.
SEARCH_TERMS: dict[str, list[str]] = {
    "brandbekaempfung": [
        "Dachstuhlbrand Flammen Rauch",
        "burning house flames smoke",
        "house on fire roof flames",
        "Wohnungsbrand Rauch Fenster",
        "building on fire smoke",
        "Hausbrand Flammen",
        "barn on fire flames",
        "Scheunenbrand",
        "burning building night flames",
        "Rauchsäule Brand",
        "Grossbrand Rauch",
        "incendie maison flammes",
        "casa in fiamme incendio",
    ],
    "elementarereignis": [
        "flooded street flooding houses",
        "Hochwasser überflutete Strasse",
        "flooded basement",
        "Überschwemmung Haus",
        "fallen tree blocking road storm",
    ],
    "strassenrettung": [
        "car crashed into tree",
        "Auto Unfall Baum",
        "car accident damage collision",
        "overturned car crash road",
        "Verkehrsunfall beschädigtes Auto",
        "car crash ditch",
        "crashed car guardrail",
        "Auffahrunfall Schaden",
        "car accident rear end damage",
        "car overturned on roof accident",
    ],
    "technische_hilfeleistung": [
        "fallen tree car storm damage",
        "storm damage roof house",
        "Sturmschaden Baum Haus",
        "tree fallen on house",
    ],
    "oelwehr": [
        "oil sheen water surface",
        "Ölfilm Wasser",
        "oil slick asphalt rainbow",
        "diesel spill asphalt",
        "heating oil tank leak",
        "oil spill contaminated soil",
    ],
    "bma_unechte_alarme": [
        "fire alarm control panel building",
        "smoke detector ceiling",
        "Brandmeldeanlage",
    ],
    "diverse_einsaetze": [
        "wasp nest house eaves",
        "hornet nest tree",
        "Wespennest Dach",
        "wasp nest roof attic",
        "Hornissennest",
    ],
    "gerettete_tiere": [
        # Animal-in-situ scenes: exactly what a Reko crew would photograph
        "cat stuck in a tree",
        "cat high up tree branch",
        "Katze im Baum",
        "cat on the roof",
        "sheep stuck fence",
        "swan trapped ice",
        "cow stuck mud",
    ],
    "strahlenwehr": [
        "radioactive waste drums",
        "radioactive warning sign drum",
        "radiation warning sign trefoil",
        "Radioaktiv Warnschild",
        "radioactive material barrel",
        "Fukushima contaminated soil bags",
        "Chernobyl exclusion zone warning sign",
    ],
    "einsatz_bahnanlagen": [
        "train derailment wreck",
        "derailed freight wagon",
        "Zugentgleisung",
        "entgleister Güterwagen",
        "derailed train accident damage",
    ],
}

# Strict license allow-list: CC0, CC BY, CC BY-SA (any version, any port).
# Explicitly NOT accepted: NC/ND variants, plain "Public domain", GFDL-only.
_LICENSE_RE = re.compile(r"^CC(0|(\s|-)BY((\s|-)SA)?)([\s-].*)?$", re.IGNORECASE)
_LICENSE_FORBIDDEN = re.compile(r"\b(NC|ND)\b", re.IGNORECASE)

# Best-effort face/person avoidance + junk filters on the file title.
# Includes responder keywords: the pool must show the raw scene before any
# response, so titles naming fire brigades, police, rescue crews or their
# apparatus are skipped outright.
_TITLE_SKIP = re.compile(
    r"portrait|selfie|face|wedding|ceremony|press conference|group photo|posing|"
    r"memorial|funeral|logo|map|diagram|drawing|painting|poster|museum|model|"
    r"protest|boycott|demonstration|parade|helicopter|"
    r"feuerwehr|firefight|fire brigade|fire engine|fire truck|brandweer|hasi[cč]|"
    r"polizei|police|ambulance|rettung|hazmat|dekon|decontamination|"
    r"drehleiter|einsatzkr|thw|l[öo]sch|extinguish|bombers|vigili del fuoco",
    re.IGNORECASE,
)

# Historic archive material (b&w/sepia, pre-1990) reads wrong on a modern
# Reko report.
_OLD_YEAR = re.compile(r"\b(18\d\d|19[0-8]\d)\b")

# Titles rejected during visual review — re-running the script skips them and
# fills the slot with the next candidate.
EXCLUDE_TITLES: set[str] = {
    # Not incident scenes (spotted in review):
    "File:Weihnachtsstern auf der Hansawiese mit Gebäude von der Feuerwehr 2023-11-24.jpg",
    "File:Weihnachtsstern auf der Hansawiese vor dem Hansa-Gymnasium Stralsund 2023-11-24.jpg",
    "File:Protest against oil company BP and their still leaking oil in the Gulf of Mexico.jpg",
    "File:Miami Beach Lincoln Mall Boycott BP.JPG",
    "File:VF-146 Agusta Westland AW139 Vigili del Fuoco (Italian Firefighters)Malta 24.9.21 (51683255002).jpg",
    "File:Anhänger, Rettungshund, Rettungsdienst Komitat Pest, Tag der Feuerwehr, 2024 Stadtwäldchen.jpg",
    "File:Hornet Nest model at Regional Museum of Natural History, Bhubaneswar.jpg",
    "File:L.S. Hornet Nest at Regional Museum of Natural History, Bhubaneswar.jpg",
    "File:Dragline Basket and Claim Shell Bucket Are Used to Scoop Oil - Laden Debris from Log Boom on the San Juan River, 10-1972.jpg",
    # Third review pass (US scenes, out of place for Swiss training):
    "File:Eastern Market Fire, 4.30.07.jpg",  # US flags front and center
    "File:48 Granger Pl. Buffalo Fire June 22.07 pt5.JPG",  # nondescript US house
    # Fourth review pass (new-type curation):
    "File:96 car Train derailment in Trinway, Ohio USA 01.jpg",  # photographer watermark
    "File:96 car Train derailment in Trinway, Ohio USA 02.jpg",  # photographer watermark
    "File:96 car Train derailment in Trinway, Ohio USA 03.jpg",  # photographer watermark
    "File:Derailment marks on outbound platform at Northeastern station, September 2012.JPG",  # empty platform
    "File:Derailment Accident Site - Amagasaki Rail Crash(63081686).jpg",  # aerial city view
    "File:Going off the rails (348294867).jpg",  # fence, no incident
    "File:挨拶 (29591464221).jpg",  # ceremony line-up, not a rescue
    "File:Yakiniku 001.jpg",  # grilled food (?!)
    "File:Fire tools- water backpacks.jpg",  # gear close-up, not a scene
    "File:W50 LF16 TS8.jpg",  # vintage museum truck
    # Second review pass:
    "File:Kyoto's firefighters.jpg",  # crowd of onlookers with visible faces
    "File:Flooding in southern Iran (49389786917).jpg",  # satellite image
    "File:View of houses on Flood Street - geograph.org.uk - 4810138.jpg",  # street name only, no flood
    "File:Traffic accident on the D6 highway, Czech Republic 08.png",  # graphic interior close-up
    "File:Verkehrsunfall auf der Neuen Hamburger Straße (Bundesstraße B 4) (Kiel 35.415).jpg",  # b&w archive
    "File:Feuerwehreinsatz nach Verkehrsunfall.jpg",  # empty winter panorama, no scene
    "File:The Fall Color Will Not Help Asheville After Helene - 4.jpg",  # photographer watermark
    "File:Espie Dods House, side view, following storm damage to roof, 2015.JPG",  # plaza, damage barely visible
    "File:Beseitigung einer Ölspur am Westring, Ecke Eckernförder Straße durch die Feuerwehr (Kiel 54.695).jpg",  # b&w archive
    "File:Ölspur - 10.jpg",  # near-duplicate of Ölspur - 09
    "File:Blue Grass Chemical Agent-Destruction Pilot Plant Standby Diesel Generators (35227778740).jpg",  # plant maintenance, no spill
    "File:GEF-PKL BAB A1 HB-HH AS Dibb 15.01.08-1.jpg",  # embedded caption overlay
    "File:Abrollbehälter-Dekontamination-Zivilpersonen der Feuerwehr Hannover.jpg",  # container side view, no scene
    "File:WLA hmns Red Wasp Nest.jpg",  # museum specimen
    "File:Wasp nest (explored) - Flickr - hedera.baltica.jpg",  # comb macro, reads as honeycomb
    "File:Rescue of storks in Maidan-Lypnenskyi, 2023-08-15 (2).jpg",  # just a hole in metal
    "File:Can Padró 1.jpg",  # fire training, wrong type
    "File:Placa Bombers a Fleming.jpg",  # memorial plaque
    "File:Poble Sec sense vehicles.jpg",  # b&w fire station
    "File:Torre de pràctiques al parc de bombers de la Ciutadella, Barcelona, cap el 1924.jpg",  # 1924 archive
    "File:Company 12 football.jpg",  # firefighters playing football, not a rescue
    "File:Swan Road ^ Swan Road Postbox - geograph.org.uk - 2572167.jpg",  # street called Swan Road, no swan
    "File:Worlingworth, Swan Road - geograph.org.uk - 6474858.jpg",  # street called Swan Road, no swan
    # "Ölspur - NN" is a series of near-identical shots of one warning sign;
    # keep only 02 for variety.
    "File:Ölspur - 01.jpg",
    "File:Ölspur - 03.jpg",
    "File:Ölspur - 04.jpg",
    "File:Ölspur - 05.jpg",
    "File:Ölspur - 06.jpg",
    "File:Ölspur - 07.jpg",
    "File:Ölspur - 08.jpg",
    "File:Ölspur - 09.jpg",
    "File:Ölspur - 10.jpg",
    "File:Ölspur - 11.jpg",
    "File:Flood embankment protecting houses in Silcoates Street - geograph.org.uk - 6727571.jpg",  # empty field
    "File:Gerätewagen Dekontamination Personal -Katastrophenschutz Hessen.jpg",  # parked truck, no scene
    "File:FW Ulm - Dekon-LKW P.jpg",  # parked truck, no scene
    "File:Hoornaar - European hornet (20725124754).jpg",  # photographer watermark
    # Fifth review pass — scene-only criterion: the pool must show the raw
    # scene BEFORE any response (no responders, apparatus, hoses, cordons,
    # warning signs). Everything below shows the response, not the scene.
    "File:Dachstuhlbrand Försterstraße 26, Ecke Ehrenfeldgürtel, Köln-9541.jpg",  # aerial ladder + crews
    "File:Dachstuhlbrand Försterstraße 26, Ecke Ehrenfeldgürtel, Köln-9547.jpg",  # aerial ladder + crews
    "File:Dachstuhlbrand Försterstraße 26, Ecke Ehrenfeldgürtel, Köln-9573.jpg",  # firefighters on scaffold
    "File:Dachstuhlbrand Försterstraße 26, Ecke Ehrenfeldgürtel, Köln-9638.jpg",  # firefighter group
    "File:Autobrand IJzendoorn.JPG",  # firefighters extinguishing
    "File:SV-RTL Firefighting (16685391802).jpg",  # crews + ambulance at car fire
    "File:BAB 8 Feuerwehr nach Loeschung eines Pkw-Brandes Bayrische Polizei.JPG",  # fire trucks + police
    "File:Feuerwehr bei Hochwasser-Einsatz.jpg",  # fire truck in flood
    "File:Hochwasser 2009 Oststeiermark 22.jpg",  # fire truck + hoses
    "File:Hochwasser Karden (2024-05-19 3 MSp).jpg",  # firefighters watching flood
    "File:BS Feuerwehr Ueberschwemmung.JPG",  # fire truck driving through flood
    "File:Traffic accident on the D6 highway, Czech Republic 03.png",  # extrication crew + timestamp
    "File:Traffic accident on the D6 highway, Czech Republic 04.png",  # extrication crew + timestamp
    "File:Traffic accident on the D6 highway, Czech Republic 05.png",  # extrication crew + timestamp
    "File:Traffic accident on the D6 highway, Czech Republic 06.png",  # extrication crew + timestamp
    "File:Wuppertal, A46 nach schwerem Verkehrsunfall an der Brücke Ehrenhainstr., von Brücke Gräfrather Str. aus.jpg",  # police + tow trucks
    "File:VU-Bad Mühllacken 2533 (39897922242).jpg",  # fire crew at rollover
    "File:VU-Bad Mühllacken 2536 (26057722248).jpg",  # fire trucks at rollover
    "File:TLF2000 Mettersdorf (51374349112).jpg",  # fire truck at crash
    "File:Ölspur - 02.jpg",  # Ölspur warning sign is responder-placed
    "File:Ölspur - 12.jpg",  # Ölspur warning sign is responder-placed
    "File:Ölspur-Mureck-20210104 113538 (50799161143).jpg",  # crew spreading absorbent
    "File:Ölspur-Mureck-20210104 113323 (50800018102).jpg",  # response trailer on scene
    "File:OilSpillCleanupGovNichollsWharf28July2008.jpg",  # boom + response boats
    "File:OilSpillCleanupShipJuly2008.jpg",  # boom + response boats
    "File:High-volume Open Sea Skimmer (HOSS) barge.jpg",  # response barge
    "File:MHE - KBH Brandvaesen - HAZMAT 1.jpg",  # hazmat crews suiting up
    "File:MHE - KBH Brandvaesen - HAZMAT 2.jpg",  # hazmat crews suiting up
    "File:MHE - KBH Brandvaesen - HAZMAT 3.jpg",  # hazmat crews suiting up
    "File:MHE - KBH Brandvaesen - HAZMAT 3a.jpg",  # hazmat crews suiting up
    "File:Abrollbehälter-Dekontamination-Zivilpersonen der Feuerwehr Hannover aufgebaut.jpg",  # decon tents
    "File:Verletzten-Transportsystem vom Abrollbehälter-Dekontamination-Zivilpersonen der Feuerwehr Hannover.jpg",  # decon interior
    "File:HAZMAT exercise in Cobb County (5436421761).jpg",  # suited responders + faces
    "File:138th Chemical Company participates in HAZMAT exercise (7972558662).jpg",  # suited responders + casualty
    "File:Firefighters Rescue Horse.jpg",  # rescue crew at work
    "File:Animal rescue.jpg",  # crews lifting horse
    "File:Rescue of storks in Maidan-Lypnenskyi, 2023-08-15 (1).jpg",  # firefighters cutting silo
    "File:Rescue of storks in Maidan-Lypnenskyi, 2023-08-15 (3).jpg",  # firefighter holding stork
    "File:Russian Blue cat (50744136351).jpg",  # house cat in Christmas tree, no incident
    "File:Strahlenschutz bfkuu denkmayr 0008 (33144375180).jpg",  # posing crew, faces
    "File:Strahlenschutz bfkuu denkmayr 0010 (33399429331).jpg",  # responder with meter
    "File:Strahlenschutz bfkuu denkmayr 0015 (33399427341).jpg",  # responders + decon pool
    "File:Strahlenschutz bfkuu denkmayr 0017 (33399426611).jpg",  # crew chatting, faces
    "File:Portable Geiger counter Berthold LB122-02.jpg",  # product shot, no scene
    "File:Geiger counter.jpg",  # product shot, no scene
    "File:Geiger counter measuring tree in Chernobyl.jpg",  # responder hand + meter
    "File:Geiger counter measuring tree at Chernobyl.jpg",  # responder hand + meter
    "File:Höhenrettung Feuerwehr München 2977.jpg",  # rope rescue crew
    "File:Höhenrettung Feuerwehr München 2973.jpg",  # rope rescue crew
    "File:Höhenrettung Feuerwehr München 2982.jpg",  # rope rescue crew
    "File:Höhenrettung Feuerwehr München 2985.jpg",  # rope rescue crew
    "File:Hauptstraße 95 (Schönheide) Feuerwehrübung V.JPG",  # aerial ladder drill
    "File:Hauptstraße 95 (Schönheide) Feuerwehrübung VI.JPG",  # aerial ladder drill
    "File:Tree-works.png",  # work platform on scene
    # Fifth review pass, round 2 (scene-only re-curation candidates):
    "File:CSIRO ScienceImage 11277 The steelframed house after the flame test at Mogo on Friday 16 April 2010.jpg",  # hi-vis crew at edge
    "File:CSIRO ScienceImage 11362 The steelframed house before the flame test at Mogo on Friday 16 April 2010.jpg",  # intact house, no incident
    "File:CSIRO ScienceImage 11113 The steelframed house at the height of the flame test at Mogo on Friday 16 April 2010.jpg",  # fire trucks both sides
    "File:System Sensor 6500 Beam Smoke Detector.jpg",  # detector close-up, wrong type
    "File:Smoke ^ Fire, Darsham - geograph.org.uk - 3400885.jpg",  # pub called Smoke & Fire, no incident
    "File:Captain D's Seafood Kitchen with smoke from fire at People's Cartage warehouse.jpg",  # obviously-American scene
    "File:Burnt out car - geograph.org.uk - 5807326.jpg",  # long-abandoned rusted wreck
    "File:20020815520NR Dresden Hochwasser im Kreuzungsbauwerk Hbf.jpg",  # embedded caption overlay
    "File:20130605490DR Dresden Hochwasser am Blockhaus.jpg",  # strolling crowd, reads as sightseeing
    "File:CarInDitch.JPG",  # cordon tape across scene + photographer shadow
    "File:The British Isles winter weather event deaths of 2010.png",  # choropleth map
    "File:Freiburg im Breisgau- Unfallauto - LABW - Staatsarchiv Freiburg W 140 Nr. 16820.jpeg",  # b&w archive
    "File:2017 05 12 Gemeindeübung PB FK Pokesch-57 (34288401680).jpg",  # firefighters at drill
    "File:PKW WARTBURG.jpg",  # b&w archive
    "File:AC Cobra (4451986754).jpg",  # car show, no incident
    "File:Flower offering at Higashi Ikebukuro 2020-02-26.jpg",  # memorial flowers, not a scene
    "File:Oil Contamination in Hirtshals, 2011 ubt.jpeg",  # authority-placed "Olie på stranden" warning sign
    "File:Leiblach-8573.jpg",  # accordion player, prominent face
    "File:Bhuj cat.jpg",  # cat on rug, no incident + phone watermark
    "File:Bundesarchiv Bild 183-55521-0001, LPG Niedergrossen, Bau eines Stalls.jpg",  # 1958 archive
    "File:Operating waste drums Olkiluoto Visitor Centre.jpg",  # visitor-centre display
    "File:Radiation and the International Atomic Energy Agency (ISEA) - radioactive material content (02910469) (53638804502).jpg",  # lab worker, face
    "File:Fûts de déchets faiblement radioactifs en Altantique Nord-Est (Ifremer 00539-65072 - 9585).jpg",  # murky seabed shot
    "File:TINT Radioactive wastes' barrel.jpg",  # storage warehouse rows, duplicate motif
    "File:TINT Radioactive wastes' Barrel.jpg",  # storage warehouse rows, duplicate motif
    "File:2017 Washington train derailment detour routes.png",  # route map
    "File:Farragut derailment 2.JPG",  # fire hoses + pump on scene
    "File:Train wreck near Rutherfordton.png",  # b&w newspaper archive
    "File:Korean Train Wreck (4233473301).jpg",  # b&w archive
    "File:Train accident derailment at Keswick (17096325922).jpg",  # no visible incident, loco behind fence
    # Fifth review pass, round 3:
    "File:Richmond Chevron Refinery fire smoke cloud over Berkley and San Francisco-0441 03.JPG",  # distant haze, obviously-American skyline
    "File:Hidden Peak Fire Lookout at sunset, with smokey haze from nearby fires.jpg",  # sunset haze, no incident
    "File:House fire with smoke.jpg",  # hose stream arcs into frame
    "File:Es brennt lichterloh.jpg",  # abstract bonfire close-up
    "File:August barn fire at Monkton Kent England 2.jpg",  # near-duplicate of the other two
    "File:Unfall- Lastwagen am Baum - LABW - Staatsarchiv Wertheim S-N 70 G 1069.jpg",  # b&w archive
    "File:Mengkofen Ziegelstadel Weiklmarterl.jpg",  # wayside memorial stone
    "File:Moscow, Smolenskaya Square, rear-end collision, June 2026 07.jpg",  # traffic police on scene
    "File:Moscow, Smolenskaya Square, rear-end collision, June 2026 06.jpg",  # traffic police on scene
    "File:Carousel F - 011 (49887286103).jpg",  # burnt-out ruin, old slide scan
    "File:Dick Chalpin (7158001130).jpg",  # men in suits, US flags
    "File:Rusty... (8600804394).jpg",  # lizard macro
    "File:Antarctica, pollution, environment, Russia, Bellingshausen 1.JPG",  # Antarctic shore, implausible scene
    "File:Fotothek df roe-neg 0006537 019 Frauen schälen Birnen im VEB Leipziger Feinkostf.jpg",  # 1950s archive
    "File:Fotothek df roe-neg 0006537 020 Frauen schälen im VEB Leipziger Feinkostfabrik B.jpg",  # 1950s archive
    "File:Fotothek df roe-neg 0006537 022 Frauen füllen im VEB Leipziger Feinkostfabrik Bi.jpg",  # 1950s archive
    "File:Fûts de déchets faiblement radioactifs en Altantique Nord-Est (Ifremer 00539-65072 - 9586).jpg",  # murky seabed shot
    "File:Fûts de déchets faiblement radioactifs en Altantique Nord-Est (Ifremer 00539-65072 - 9587).jpg",  # murky seabed shot
    "File:Sign at Entrance to Chernobyl Exclusion Zone - Northern Ukraine (26825581640).jpg",  # Ukraine-specific text panel
    "File:Derailed tram Gdansk jan 2013 ubt.jpg",  # reads as snowy traffic, incident invisible
    "File:2013-05-18 MTR Light Rail Derailment Accident Aftermath (26) (8751222520).jpg",  # work crews + caption overlay
    "File:Derailment (50895874993).jpg",  # b&w archive look
    # Fifth review pass, round 4:
    "File:Building Smoke (6093922507).jpg",  # wildfire smoke bank over US ranch, off-brief
    "File:2019 Getty Fire smoke from Santa Monica.jpg",  # LA palms, obviously-American scene
    "File:Scheunenbrand Petersberg DSC00488.jpg",  # fire trucks across the meadow
    "File:Scheunenbrand Petersberg DSC00506.jpg",  # firefighters at burnt barn
    "File:Amfleet car and locomotive after July 2011 grade crossing accident.jpg",  # train close-up, incident invisible
    "File:CrashBarrier.jpg",  # damaged barrier only, no subject
    "File:Flower offering at Higashi Ikebukuro 2019-04-28.jpg",  # memorial flowers, not a scene
    "File:Wadsworth Road Fire Smoke and rooftops panorama.jpg",  # near-duplicate letterbox panorama
    "File:Scheunenbrand Petersberg DSC00509.jpg",  # firefighters + hose lines
    "File:Two car accident temporarily closes Rock Quarry Road (15468891310).jpg",  # tow truck on scene
    "File:Dumped Oil Drums - Tottenham Green East (18794037225).jpg",  # two-photo collage
    "File:Prep Dump.jpg",  # embedded timestamp overlay
    "File:Almost there . . . (3214659707).jpg",  # collage, fly-tipped suitcase (not chemical)
    # chemiewehr was retired after this pass: Commons has no scene-only
    # Gefahrgut imagery (only hazmat crews/exercises); the two compliant
    # finds were too few to ship without constant repetition.
    "File:Impacto do ser humano sobre a natureza.jpg",  # grainy scan; pool retired
    "File:37hazwaste (4085488575).jpg",  # pool retired, below minimum pool size
    "File:Train accident derailment at Keswick (16890231857).jpg",  # hi-vis workers at the loco
    "File:Private Well Next 2 AST (4562779921).jpg",  # inspector's leg at frame edge
}

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def _clean_html(value: str) -> str:
    """Strip tags/whitespace from an extmetadata HTML value."""
    text = re.sub(r"<[^>]+>", "", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120] if text else "unknown"


def _license_ok(short_name: str) -> bool:
    if _LICENSE_FORBIDDEN.search(short_name):
        return False
    return bool(_LICENSE_RE.match(short_name.strip()))


def search_candidates(term: str, limit: int = 40) -> list[dict]:
    """Commons file-namespace search with imageinfo + extmetadata."""
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": term,
        "gsrnamespace": 6,  # File:
        "gsrlimit": limit,
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": 1600,
    }
    resp = session.get(API_URL, params=params, timeout=30)
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", {})
    # Preserve search relevance order
    return [p for p in sorted(pages.values(), key=lambda p: p.get("index", 999))]


def evaluate(page: dict) -> dict | None:
    """Return a candidate record if the page passes all filters, else None."""
    title = page.get("title", "")
    if title in EXCLUDE_TITLES or _TITLE_SKIP.search(title) or _OLD_YEAR.search(title):
        return None
    infos = page.get("imageinfo") or []
    if not infos:
        return None
    info = infos[0]
    if info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
        return None
    if (info.get("width") or 0) < MIN_WIDTH:
        return None
    meta = info.get("extmetadata") or {}
    license_short = _clean_html(meta.get("LicenseShortName", {}).get("value", ""))
    if not _license_ok(license_short):
        return None
    return {
        "title": title,
        "author": _clean_html(meta.get("Artist", {}).get("value", "unknown")),
        "license": license_short,
        "source_url": info.get("descriptionurl") or info.get("descriptionshorturl") or "",
        # thumburl is a pre-scaled 1600px derivative — enough for our 1280px
        # target and far smaller than multi-MB originals.
        "download_url": info.get("thumburl") or info.get("url"),
    }


def download_and_process(url: str) -> bytes | None:
    """Download, resize longest edge to MAX_EDGE, re-encode JPEG (strips EXIF)."""
    try:
        resp = None
        for attempt in range(4):
            resp = session.get(url, timeout=60)
            if resp.status_code == 429:  # rate limited: back off and retry
                wait = 10 * (attempt + 1)
                print(f"    ~ 429 rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            break
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content))
        img.load()
    except Exception as exc:
        print(f"    ! download/decode failed: {exc}")
        return None

    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    # Saving a fresh PIL image without exif kwarg strips all EXIF metadata.
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def curate_type(incident_type: str, terms: list[str]) -> list[dict]:
    """Download up to TARGET_PER_TYPE images for one incident type."""
    type_dir = POOL_DIR / incident_type
    type_dir.mkdir(parents=True, exist_ok=True)
    # Fresh run: replace previous pool for this type
    for old in type_dir.glob("*.jpg"):
        old.unlink()

    records: list[dict] = []
    seen_titles: set[str] = set()
    for term in terms:
        if len(records) >= TARGET_PER_TYPE:
            break
        print(f"  searching: {term!r}")
        try:
            pages = search_candidates(term)
        except Exception as exc:
            print(f"    ! search failed: {exc}")
            continue
        taken_for_term = 0
        for page in pages:
            if len(records) >= TARGET_PER_TYPE or taken_for_term >= MAX_PER_TERM:
                break
            candidate = evaluate(page)
            if not candidate or candidate["title"] in seen_titles:
                continue
            seen_titles.add(candidate["title"])
            data = download_and_process(candidate["download_url"])
            time.sleep(1.0)  # be polite to Commons
            if not data:
                continue
            filename = f"{len(records) + 1:02d}.jpg"
            (type_dir / filename).write_bytes(data)
            candidate["filename"] = filename
            records.append(candidate)
            taken_for_term += 1
            print(f"    + {filename}  {candidate['license']:<14} {candidate['title']}")
    return records


def write_attribution(all_records: dict[str, list[dict]]) -> None:
    lines = [
        "# Training Photo Pool — Attribution",
        "",
        "Scene photos for simulated training Reko reports, curated from",
        "[Wikimedia Commons](https://commons.wikimedia.org/) via",
        "`scripts/download-training-photos.py`. All images are CC0, CC BY or",
        "CC BY-SA licensed; they were resized (longest edge 1280 px),",
        "re-encoded (JPEG q80) and stripped of EXIF metadata.",
        "",
    ]
    for incident_type, records in all_records.items():
        lines.append(f"## {incident_type}")
        lines.append("")
        lines.append("| File | Author | License | Source |")
        lines.append("|------|--------|---------|--------|")
        for r in records:
            author = r["author"].replace("|", "\\|")
            title = r["title"].replace("|", "\\|")
            lines.append(f"| {r['filename']} | {author} | {r['license']} | [{title}]({r['source_url']}) |")
        lines.append("")
    (POOL_DIR / "ATTRIBUTION.md").write_text("\n".join(lines), encoding="utf-8")


def _load_existing_records() -> dict[str, list[dict]]:
    """Parse ATTRIBUTION.md back into records so partial re-runs (a subset of
    types passed on the CLI) keep the attribution of untouched types."""
    attribution = POOL_DIR / "ATTRIBUTION.md"
    records: dict[str, list[dict]] = {}
    if not attribution.exists():
        return records
    current: list[dict] | None = None
    for line in attribution.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            current = records.setdefault(line[3:].strip(), [])
        elif current is not None and line.startswith("| ") and line.endswith(" |") and ".jpg" in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) == 4:
                m = re.match(r"\[(.*)\]\((.*)\)", cells[3])
                current.append(
                    {
                        "filename": cells[0],
                        "author": cells[1],
                        "license": cells[2],
                        "title": m.group(1) if m else cells[3],
                        "source_url": m.group(2) if m else "",
                    }
                )
    return records


def main() -> int:
    POOL_DIR.mkdir(parents=True, exist_ok=True)
    only_types = set(sys.argv[1:])  # optional: re-curate just these types
    unknown = only_types - set(SEARCH_TERMS)
    if unknown:
        print(f"Unknown incident types: {', '.join(sorted(unknown))}")
        return 1

    all_records = _load_existing_records()
    total_bytes = 0
    for incident_type, terms in SEARCH_TERMS.items():
        if only_types and incident_type not in only_types:
            continue
        print(f"\n=== {incident_type} ===")
        records = curate_type(incident_type, terms)
        all_records[incident_type] = records
        size = sum(f.stat().st_size for f in (POOL_DIR / incident_type).glob("*.jpg"))
        total_bytes += size
        print(f"  -> {len(records)} images, {size / 1024:.0f} KiB")
        if len(records) < 6:
            print(f"  ! WARNING: only {len(records)} images (target 6-10)")

    write_attribution(all_records)
    print(f"\nTotal pool size: {total_bytes / (1024 * 1024):.1f} MiB")
    print(f"Attribution written to {POOL_DIR / 'ATTRIBUTION.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
