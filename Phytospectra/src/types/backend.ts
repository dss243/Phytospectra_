export type Gps = { lat: number; lng: number };

export type Field = {
  id: string;
  user_id: string;
  field_name: string;
  crop_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  area_hectares?: number | null;
  boundary?: Record<string, unknown> | null;
  created_at?: string;
};

export type Drone = {
  id: string;
  user_id: string;
  drone_name: string;
  drone_model?: string | null;
  esp32_device_id?: string | null;
  multispectral_camera?: string | null;
  created_at?: string;
};

export type Flight = {
  id: string;
  user_id: string;
  field_id: string;
  drone_id?: string | null;
  altitude?: number | null;
  weather?: string | null;
  flight_date?: string | null;
  drone_name?: string;
  field_name?: string;
};

export type ImageRow = {
  id: string;
  user_id: string;
  field_id?: string | null;
  flight_id?: string | null;
  drone_id?: string | null;
  storage_path?: string;
  bucket_name?: string;
  gps?: Record<string, unknown> | null;
  gps_source?: string | null;
  upload_source?: string | null;
  uploaded_at?: string;
};

export type SegmentationRow = {
  id?: string;
  user_id: string;
  image_id: string;
  field_id?: string | null;
  flight_id?: string | null;
  drone_id?: string | null;
  heatmap_url?: string | null;
  ndvi_mean?: number | null;
  gndvi_mean?: number | null;
  health_score?: number | null;
  stress_class?: string | null;
  confidence?: number | null;
  healthy_pixel_count?: number | null;
  stressed_pixel_count?: number | null;
  health_percentage?: number | null;
  gps?: Record<string, unknown> | null;
  processed_at?: string;
  images?: {
    storage_path?: string;
    gps?: Record<string, unknown> | null;
    captured_at?: string;
  };
};

export type DetectionMessage = {
  zone_id: string;
  timestamp: string;
  gps: Gps;
  health_score: number;
  stress_class: string;
  confidence: number;
  heatmap_url?: string;
  drone_image_url?: string;
};

