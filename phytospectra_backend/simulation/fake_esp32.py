# simulation/fake_esp32_advanced.py

import os
import sys
import json
import time
import random
import requests
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import exifread
from PIL import Image
import numpy as np

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("esp32_simulator")

# Configuration
CHUNK_SIZE = 8192  # 8KB chunks like real ESP32
BATCH_DELAY = 2    # Seconds between image uploads
FLIGHT_DELAY = 30  # Seconds between flights


class GPSData:
    """Simulate GPS data from MAPIR camera"""
    
    @staticmethod
    def generate_random_gps(center_lat: float = 36.48, center_lon: float = 2.95, 
                           radius_km: float = 0.5) -> Tuple[float, float]:
        """Generate random GPS coordinates within radius of center"""
        # Convert radius to degrees (approx 111km per degree)
        radius_deg = radius_km / 111.0
        
        # Random angle and distance
        angle = random.uniform(0, 2 * np.pi)
        distance = random.uniform(0, radius_deg)
        
        lat = center_lat + distance * np.cos(angle)
        lon = center_lon + distance * np.sin(angle)
        
        return round(lat, 6), round(lon, 6)
    
    @staticmethod
    def extract_from_image(image_path: str) -> Optional[Dict]:
        """Extract GPS from image EXIF if available"""
        try:
            with open(image_path, 'rb') as f:
                tags = exifread.process_file(f)
            
            # Look for GPS tags
            if 'GPS GPSLatitude' in tags and 'GPS GPSLongitude' in tags:
                lat = tags['GPS GPSLatitude'].values
                lon = tags['GPS GPSLongitude'].values
                
                # Convert to decimal degrees
                lat_deg = float(lat[0].num) / float(lat[0].den)
                lat_min = float(lat[1].num) / float(lat[1].den)
                lat_sec = float(lat[2].num) / float(lat[2].den)
                lat_decimal = lat_deg + lat_min/60 + lat_sec/3600
                
                lon_deg = float(lon[0].num) / float(lon[0].den)
                lon_min = float(lon[1].num) / float(lon[1].den)
                lon_sec = float(lon[2].num) / float(lon[2].den)
                lon_decimal = lon_deg + lon_min/60 + lon_sec/3600
                
                # Apply direction
                if 'GPS GPSLatitudeRef' in tags and str(tags['GPS GPSLatitudeRef']) == 'S':
                    lat_decimal = -lat_decimal
                if 'GPS GPSLongitudeRef' in tags and str(tags['GPS GPSLongitudeRef']) == 'W':
                    lon_decimal = -lon_decimal
                
                return {
                    "latitude": round(lat_decimal, 6),
                    "longitude": round(lon_decimal, 6),
                    "altitude": float(tags.get('GPS GPSAltitude', [0])[0]) if 'GPS GPSAltitude' in tags else None
                }
        except Exception as e:
            logger.debug(f"Could not extract GPS from {image_path}: {e}")
        
        return None
    
    @staticmethod
    def create_gpx_track(waypoints: List[Dict], output_path: str):
        """Create GPX track file for visualization"""
        gpx_template = '''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ESP32 Simulator">
  <trk>
    <name>Drone Flight Path</name>
    <trkseg>
{segments}
    </trkseg>
  </trk>
</gpx>'''
        
        segments = []
        for wp in waypoints:
            segments.append(f'''      <trkpt lat="{wp['latitude']}" lon="{wp['longitude']}">
        <ele>{wp.get('altitude', 0)}</ele>
        <time>{wp['timestamp']}</time>
      </trkpt>''')
        
        with open(output_path, 'w') as f:
            f.write(gpx_template.format(segments='\n'.join(segments)))
        
        logger.info(f"GPX track saved: {output_path}")


class ESP32Simulator:
    """Simulate ESP32 uploading images with GPS data"""
    
    def __init__(self, api_url: str, token: str, field_id: str = None, 
                 flight_id: str = None, drone_id: str = None):
        self.api_url = api_url.rstrip('/')
        self.token = token
        self.field_id = field_id
        self.flight_id = flight_id
        self.drone_id = drone_id
        self.headers = {
            "Authorization": f"Bearer {token}"
        }
        self.uploaded_images = []
        self.gps_track = []
        
    def upload_image_with_gps(self, image_path: str, gps_data: Dict = None) -> Dict:
        """
        Upload single image with GPS metadata
        Simulates ESP32 chunked upload behavior
        """
        if not os.path.exists(image_path):
            logger.error(f"File not found: {image_path}")
            return None
        
        filename = os.path.basename(image_path)
        file_size = os.path.getsize(image_path)
        
        # Extract GPS from image if not provided
        if gps_data is None:
            gps_data = GPSData.extract_from_image(image_path)
        
        # Read image file
        with open(image_path, "rb") as f:
            contents = f.read()
        
        # Prepare form data
        files = {"file": (filename, contents, "image/jpeg")}
        data = {
            "field_id": self.field_id or "",
            "flight_id": self.flight_id or "",
            "drone_id": self.drone_id or "",
        }
        
        # Add GPS if available
        if gps_data:
            data["latitude"] = str(gps_data.get("latitude", ""))
            data["longitude"] = str(gps_data.get("longitude", ""))
            data["altitude"] = str(gps_data.get("altitude", ""))
        
        try:
            # Simulate chunked upload (just for logging)
            logger.info(f"📤 Uploading: {filename} ({file_size:,} bytes)")
            
            # In real ESP32, data would be sent in chunks
            num_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
            logger.debug(f"   Sending in {num_chunks} chunks of {CHUNK_SIZE} bytes")
            
            # Actual upload
            response = requests.post(
                f"{self.api_url}/api/upload-with-gps",
                headers=self.headers,
                files=files,
                data=data,
                timeout=60
            )
            response.raise_for_status()
            result = response.json()
            
            # Record upload with GPS
            upload_record = {
                "filename": filename,
                "storage_path": result.get("storage_path"),
                "gps": gps_data,
                "timestamp": datetime.utcnow().isoformat(),
                "analysis": result.get("analysis")
            }
            self.uploaded_images.append(upload_record)
            
            # Add to GPS track
            if gps_data:
                self.gps_track.append({
                    "latitude": gps_data["latitude"],
                    "longitude": gps_data["longitude"],
                    "altitude": gps_data.get("altitude", 0),
                    "timestamp": datetime.utcnow().isoformat(),
                    "image": filename
                })
            
            logger.info(f"✓ Uploaded: {filename} → {result.get('storage_path')}")
            
            # Show analysis if available
            if result.get("analysis"):
                analysis = result["analysis"]
                logger.info(f"   🌿 Health: {analysis.get('health_score', 0):.1f}% | "
                           f"Status: {analysis.get('stress_class', 'unknown')}")
                if analysis.get("gps"):
                    logger.info(f"   📍 GPS: {analysis['gps'].get('latitude', 'N/A')}, "
                               f"{analysis['gps'].get('longitude', 'N/A')}")
            
            return result
            
        except requests.HTTPError as e:
            logger.error(f"Upload failed: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Upload error: {e}")
            return None
    
    def simulate_flight(self, image_folder: str, waypoints: List[Dict] = None,
                       auto_gps: bool = True, delay: float = BATCH_DELAY):
        """
        Simulate a full drone flight with multiple images
        """
        image_folder = Path(image_folder)
        if not image_folder.exists():
            logger.error(f"Image folder not found: {image_folder}")
            return
        
        # Get all images
        extensions = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
        images = sorted([f for f in image_folder.iterdir() 
                        if f.suffix.lower() in extensions])
        
        if not images:
            logger.error(f"No images found in {image_folder}")
            return
        
        logger.info(f"\n{'='*60}")
        logger.info(f"🚁 DRONE FLIGHT SIMULATION STARTED")
        logger.info(f"{'='*60}")
        logger.info(f"Images: {len(images)}")
        logger.info(f"Field ID: {self.field_id or 'Not specified'}")
        logger.info(f"Flight ID: {self.flight_id or 'Auto-generated'}")
        logger.info(f"Auto GPS: {auto_gps}")
        logger.info(f"{'='*60}\n")
        
        # Generate flight ID if not provided
        if not self.flight_id:
            self.flight_id = f"sim_flight_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            logger.info(f"Auto-generated flight ID: {self.flight_id}")
        
        # Simulate flight path
        for idx, img_path in enumerate(images, 1):
            logger.info(f"\n📸 Image {idx}/{len(images)}: {img_path.name}")
            
            # Get GPS for this image
            gps_data = None
            if auto_gps:
                if waypoints and idx <= len(waypoints):
                    gps_data = waypoints[idx-1]
                else:
                    # Generate random GPS around field center
                    center_lat = waypoints[0]["latitude"] if waypoints else 36.48
                    center_lon = waypoints[0]["longitude"] if waypoints else 2.95
                    lat, lon = GPSData.generate_random_gps(center_lat, center_lon, 0.3)
                    gps_data = {"latitude": lat, "longitude": lon, "altitude": 50}
            
            # Upload image
            result = self.upload_image_with_gps(img_path, gps_data)
            
            if idx < len(images):
                logger.info(f"⏱️  Waiting {delay}s before next image...")
                time.sleep(delay)
        
        # Save flight summary
        self.save_flight_summary()
        
        # Create GPX track
        if self.gps_track:
            gpx_path = f"flight_tracks/{self.flight_id}_track.gpx"
            GPSData.create_gpx_track(self.gps_track, gpx_path)
        
        logger.info(f"\n{'='*60}")
        logger.info(f"✅ FLIGHT COMPLETE")
        logger.info(f"{'='*60}")
        logger.info(f"Uploaded: {len(self.uploaded_images)}/{len(images)} images")
        logger.info(f"Flight ID: {self.flight_id}")
        logger.info(f"GPX Track: {gpx_path if self.gps_track else 'Not created'}")
        
        return self.uploaded_images
    
    def save_flight_summary(self):
        """Save flight summary to JSON file"""
        summary = {
            "flight_id": self.flight_id,
            "field_id": self.field_id,
            "drone_id": self.drone_id,
            "timestamp": datetime.utcnow().isoformat(),
            "total_images": len(self.uploaded_images),
            "images": self.uploaded_images,
            "gps_track": self.gps_track
        }
        
        summary_dir = Path("flight_summaries")
        summary_dir.mkdir(exist_ok=True)
        
        summary_path = summary_dir / f"{self.flight_id}.json"
        with open(summary_path, "w") as f:
            json.dump(summary, f, indent=2)
        
        logger.info(f"📄 Flight summary saved: {summary_path}")


def create_sample_flight_plan(output_path: str = "flight_plan.json"):
    """Create a sample flight plan with waypoints"""
    waypoints = []
    
    # Create a grid flight pattern
    center_lat, center_lon = 36.48, 2.95
    spacing = 0.001  # ~111 meters
    rows, cols = 3, 4
    
    for i in range(rows):
        for j in range(cols):
            lat = center_lat + (i - rows/2) * spacing
            lon = center_lon + (j - cols/2) * spacing
            waypoints.append({
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "altitude": 50,
                "order": i * cols + j + 1
            })
    
    flight_plan = {
        "name": "Sample Grid Flight",
        "field_id": "field_123",
        "drone_id": "drone_001",
        "altitude": 50,
        "speed": 5,
        "waypoints": waypoints
    }
    
    with open(output_path, "w") as f:
        json.dump(flight_plan, f, indent=2)
    
    logger.info(f"Sample flight plan created: {output_path}")
    return flight_plan


def main():
    parser = argparse.ArgumentParser(description="ESP32 Simulator with GPS")
    parser.add_argument("--folder", required=True, help="Folder with images to upload")
    parser.add_argument("--api", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--token", required=True, help="JWT token")
    parser.add_argument("--field-id", help="Field ID")
    parser.add_argument("--flight-id", help="Flight ID (auto-generated if not provided)")
    parser.add_argument("--drone-id", help="Drone ID")
    parser.add_argument("--waypoints", help="JSON file with waypoints")
    parser.add_argument("--no-auto-gps", action="store_true", help="Don't auto-generate GPS")
    parser.add_argument("--delay", type=float, default=BATCH_DELAY, help="Delay between uploads (seconds)")
    parser.add_argument("--create-flight-plan", action="store_true", help="Create sample flight plan")
    
    args = parser.parse_args()
    
    # Create sample flight plan if requested
    if args.create_flight_plan:
        create_sample_flight_plan()
        return
    
    # Load waypoints if provided
    waypoints = None
    if args.waypoints:
        with open(args.waypoints, "r") as f:
            flight_plan = json.load(f)
            waypoints = flight_plan.get("waypoints", [])
            args.field_id = args.field_id or flight_plan.get("field_id")
            args.drone_id = args.drone_id or flight_plan.get("drone_id")
    
    # Initialize simulator
    simulator = ESP32Simulator(
        api_url=args.api,
        token=args.token,
        field_id=args.field_id,
        flight_id=args.flight_id,
        drone_id=args.drone_id
    )
    
    # Run flight simulation
    simulator.simulate_flight(
        image_folder=args.folder,
        waypoints=waypoints,
        auto_gps=not args.no_auto_gps,
        delay=args.delay
    )


if __name__ == "__main__":
    main()