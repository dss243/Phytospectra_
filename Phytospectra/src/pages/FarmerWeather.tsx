import { FarmerWeatherForecast } from "@/components/FarmerWeatherForecast";
import { useAuth } from "@/hooks/useAuth";

export default function FarmerWeather() {
  const { role, loading } = useAuth();

  if (loading) return null;
  if (role !== "farmer") return null;

  return (
    <div className="px-2">
      <FarmerWeatherForecast />
    </div>
  );
}

