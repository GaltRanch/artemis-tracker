# Artemis Tracker

Real-time mission tracker for NASA's Artemis program. Currently tracking **Artemis II** — the first crewed lunar flyby in over 50 years.

Built with vanilla JS, Three.js for 3D visualization, and 7 NASA APIs providing live mission data.

![Artemis II Crew](https://images-assets.nasa.gov/image/KSC-20230807-PH-KLS01_0518/KSC-20230807-PH-KLS01_0518~large.jpg)

## Live Data Sources

| Source | Data | Update Frequency |
|--------|------|-----------------|
| **JPL Horizons** | Spacecraft position, velocity, trajectory, RA/DEC, constellation | 5 min |
| **DSN Now** | Which antennas are communicating with Orion (EM2), signal bands, data rate, range | 60 sec |
| **DONKI** | Solar flares, geomagnetic storms, CMEs, radiation belt enhancements, interplanetary shocks | 10 min |
| **EPIC** | Real photos of Earth from 1.5M km (DSCOVR satellite at L1) | 10 min |
| **APOD** | NASA Astronomy Picture of the Day | 10 min |
| **NeoWs** | Near-Earth objects, hazardous asteroids, Sentry-monitored objects | 10 min |
| **NASA Images** | Official Artemis II mission photos | 10 min |

## Features

### Trajectory
- **3D visualization** (Three.js) with real NASA textures for Earth and Moon
- **2D canvas fallback** when WebGL is unavailable
- Real trajectory data from JPL Horizons (~214 position points)
- Full **Moon orbital path** showing where the flyby will occur
- Coordinate rotation so Earth-Moon axis is horizontal
- Zoom (scroll/pinch), pan (drag), and orbit controls
- TLI marker, flyby point, traveled vs predicted path

### Telemetry
- Distance to Earth and Moon (3D, center-to-center)
- Velocity and radial velocity
- Right Ascension / Declination (celestial coordinates)
- Constellation, light-time delay, solar distance
- Interpolated between real JPL data points for smooth updates

### Deep Space Network
- Live world map showing Goldstone, Madrid, and Canberra stations
- Animated signal arcs when antennas are tracking Orion (EM2)
- Per-dish details: azimuth, elevation, band (S/X/Ka), data rate, power
- Range and round-trip light time

### Space Weather
- Radiation risk gauge for crew safety (combines DONKI data with Orion position)
- Solar flares by class (X/M/C) with timeline overlay on mission
- Geomagnetic storms with Kp index
- Radiation belt enhancements and interplanetary shocks
- Space weather vs mission timeline chart

### Mission Data
- Exact timeline from JPL Horizons ephemeris (13 events with MET times)
- Crew info with historical firsts
- CubeSat status (ATENEA, TACHELES, K-RadCube, Space Weather CubeSat-1)
- Vehicle specs (SLS Block 1, Orion MPCV "Integrity", ESM)
- NASA TV live streams + Orion camera feed
- NEO proximity radar
- Official photo gallery

### Mobile
- Responsive layout for iPhone 16 (393x852)
- Touch zoom/pan on trajectory
- Safe-area support for notch
- PWA-ready meta tags

## Setup

```bash
git clone https://github.com/GaltRanch/artemis-tracker.git
cd artemis-tracker
node server.js
```

Open http://localhost:20000

On first visit, the app will guide you to get a free NASA API key:

1. Go to [api.nasa.gov](https://api.nasa.gov/)
2. Sign up (free, 30 seconds)
3. Paste the key in the setup modal

Without a key, the app uses `DEMO_KEY` (limited to 30 requests/hour). With your own key: 1,000 requests/hour.

Alternatively, create a `.env` file:

```
NASA_API_KEY=your_key_here
```

## Architecture

```
artemis-tracker/
├── server.js              # Node.js proxy server (Horizons, DSN, DONKI, EPIC, APOD, NeoWs, Images)
├── index.html             # Dashboard layout
├── css/style.css          # Dark theme, responsive
├── js/
│   ├── telemetry.js       # JPL Horizons telemetry engine
│   ├── trajectory.js      # 2D canvas trajectory (fallback)
│   ├── trajectory3d.js    # Three.js 3D trajectory (ES module)
│   ├── datasources.js     # DSN, DONKI, EPIC, APOD, NeoWs, Images
│   ├── widgets.js         # DSN map, radiation gauge, NEO radar, weather timeline
│   └── app.js             # Main app, renderers, API key setup
├── .env                   # NASA API key (not committed)
└── .gitignore
```

The Node.js server acts as a proxy to avoid CORS issues with NASA APIs. It includes:
- Request queue to avoid rate limiting (serialized with delays)
- Response cache (1 min for DSN, 3 min for Horizons, 30 min for DONKI/EPIC/Images)
- `.env` file support for API key persistence

## Adapting for Future Missions

The tracker is designed to be reused for Artemis III, IV, V, etc. To switch missions:

1. Update `MISSION` config in `js/app.js`:
```js
const MISSION = {
  name: 'Artemis III',
  horizonsId: '-1025',  // JPL Horizons spacecraft ID
  launchDate: '2027-...',
  durationDays: 30,
  // ...
};
```

2. Update the timeline events in `index.html`
3. Update crew info and CubeSat data

JPL Horizons assigns unique IDs to each spacecraft. The trajectory, telemetry, and 3D visualization will automatically use the new mission data.

## Requirements

- Node.js 18+
- Modern browser with ES module support
- WebGL for 3D trajectory (falls back to 2D canvas)

## Credits

- Trajectory and telemetry data: [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- Deep Space Network: [DSN Now](https://eyes.nasa.gov/dsn/dsn.html)
- Space weather: [NASA DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/)
- Earth imagery: [NASA EPIC/DSCOVR](https://epic.gsfc.nasa.gov/)
- Earth/Moon textures: [Solar System Scope](https://www.solarsystemscope.com/textures/)
- 3D engine: [Three.js](https://threejs.org/)

## License

MIT License. See [LICENSE](LICENSE).

NASA data and images are public domain. Not an official NASA product.
