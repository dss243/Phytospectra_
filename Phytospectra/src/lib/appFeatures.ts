import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Camera,
  CloudUpload,
  MessageSquare,
  Shapes,
} from "lucide-react";
import type { ComponentProps } from "react";
import { IconBox } from "@/components/IconBox";

type Accent = NonNullable<ComponentProps<typeof IconBox>["accent"]>;

export type AppFeature = {
  icon: LucideIcon;
  label: string;
  desc: string;
  accent: Accent;
};

export const CORE_FEATURES: AppFeature[] = [
  {
    icon: Camera,
    label: "Leaf camera scan",
    desc: "Detect stress from your MAPIR camera",
    accent: "green",
  },
  {
    icon: CloudUpload,
    label: "Cloud sync",
    desc: "Drone flights sync automatically to the cloud",
    accent: "green",
  },
  {
    icon: Shapes,
    label: "AI segmentation",
    desc: "Crop-class masks per drone flight",
    accent: "green",
  },
  {
    icon: BarChart3,
    label: "Field analytics",
    desc: "Trends and zone health from each pass",
    accent: "green",
  },
  {
    icon: Bot,
    label: "AI assistant",
    desc: "Quick crop guidance chat",
    accent: "green",
  },
  {
    icon: MessageSquare,
    label: "Expert advice",
    desc: "Talk to an agronomist",
    accent: "green",
  },
];

export const HERO_PILLS = CORE_FEATURES.map((f) => f.label);
