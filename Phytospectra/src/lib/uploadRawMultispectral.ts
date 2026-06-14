import { supabase } from "@/integrations/supabase/client";

export async function uploadRawMultispectralImage(params: {
  file: File;
  userId: string;
  fieldId: string;
  flightId: string;
  bucket?: string;
}) {
  const {
    file,
    userId,
    fieldId,
    flightId,
    bucket = "multispectral",
  } = params;

  // Refresh session first to avoid stale token errors
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !sessionData.session) {
    // Try refreshing if session is missing
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session) {
      throw new Error("Session expired. Please sign in again.");
    }
  }

  const safeFileName = (file.name || "")
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/%/g, "_%");

  const safePathParts = [userId, fieldId, flightId].map((p) =>
    String(p)
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/%/g, "_%")
  );

  const filePath = `${safePathParts[0]}/${safePathParts[1]}/${safePathParts[2]}/${safeFileName}`;

  console.debug("[uploadRawMultispectralImage] bucket=", bucket, "filePath=", filePath);

  // Do NOT pass custom headers — supabase-js uses the session internally
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, {
      upsert: true,
      contentType: file.type || undefined,
      // No `headers` option here — it's not a valid option and breaks auth
    });

  if (error) {
    console.error("[uploadRawMultispectralImage] upload error:", error);
    throw error;
  }

  return data;
}