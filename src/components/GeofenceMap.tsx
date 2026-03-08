import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Navigation } from "lucide-react";

// Fix default marker icons for Leaflet + bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const currentPosIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "hue-rotate-[200deg] brightness-150 saturate-150",
});

interface GeofenceMapProps {
  homeLat: number | null;
  homeLng: number | null;
  homeRadius: number;
  currentDistance: number | null;
  isInside: boolean;
}

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export function GeofenceMap({ homeLat, homeLng, homeRadius, currentDistance, isInside }: GeofenceMapProps) {
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const centerLat = homeLat ?? currentPos?.lat ?? 0;
  const centerLng = homeLng ?? currentPos?.lng ?? 0;

  if (centerLat === 0 && centerLng === 0) {
    return (
      <div className="h-48 rounded-md border border-border/30 bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">
        Waiting for location data...
      </div>
    );
  }

  // Calculate zoom based on radius
  const getZoom = (radius: number) => {
    if (radius > 1500) return 13;
    if (radius > 800) return 14;
    if (radius > 400) return 15;
    if (radius > 200) return 16;
    return 17;
  };

  return (
    <div className="space-y-1.5">
      <div className="relative rounded-md overflow-hidden border border-border/30" style={{ height: 200 }}>
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={getZoom(homeRadius)}
          scrollWheelZoom={false}
          dragging={true}
          zoomControl={false}
          attributionControl={false}
          style={{ height: "100%", width: "100%", borderRadius: "0.375rem" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <RecenterMap lat={centerLat} lng={centerLng} />

          {/* Home geofence radius circle */}
          {homeLat !== null && homeLng !== null && (
            <>
              <Circle
                center={[homeLat, homeLng]}
                radius={homeRadius}
                pathOptions={{
                  color: isInside ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)",
                  fillColor: isInside ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)",
                  fillOpacity: 0.12,
                  weight: 2,
                }}
              />
              <Marker position={[homeLat, homeLng]}>
                <Popup>🏠 Home</Popup>
              </Marker>
            </>
          )}

          {/* Current position marker */}
          {currentPos && (
            <Marker position={[currentPos.lat, currentPos.lng]} icon={currentPosIcon}>
              <Popup>📱 You are here</Popup>
            </Marker>
          )}
        </MapContainer>

        {/* Distance overlay */}
        {currentDistance !== null && (
          <div className="absolute bottom-2 left-2 z-[1000]">
            <Badge
              variant={isInside ? "default" : "destructive"}
              className="text-[10px] gap-1 shadow-md"
            >
              <Navigation className="h-2.5 w-2.5" />
              {currentDistance >= 1000
                ? `${(currentDistance / 1000).toFixed(1)}km away`
                : `${currentDistance}m away`}
            </Badge>
          </div>
        )}

        <div className="absolute top-2 right-2 z-[1000]">
          <Badge variant="outline" className="text-[9px] bg-background/80 backdrop-blur shadow-sm">
            {homeRadius}m radius
          </Badge>
        </div>
      </div>
    </div>
  );
}
