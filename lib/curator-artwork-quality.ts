import sharp from "sharp";

export type ArtworkQualityTier = "archive" | "usable" | "unusable";

export type ArtworkQualityReport = {
  tier: ArtworkQualityTier;
  width: number;
  height: number;
  format: string;
  byteSize: number;
  sourceUrl: string | null;
  thresholds: {
    archiveMinDimension: number;
    usableMinDimension: number;
    unusableMinDimension: number;
    minByteSize: number;
  };
  message: string;
  timings?: {
    image_metadata_read: number;
    dimension_validation: number;
    quality_assessment: number;
  };
};

export const ARTWORK_QUALITY_THRESHOLDS = {
  archiveMinDimension: 800,
  usableMinDimension: 450,
  unusableMinDimension: 300,
  minByteSize: 1024,
} as const;

const SUPPORTED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif", "tiff"]);

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

export async function assessArtworkQuality(
  bytes: Buffer,
  sourceUrl: string | null,
): Promise<ArtworkQualityReport> {
  let metadata: sharp.Metadata;
  const metadataStart = performance.now();
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new Error("image_unreadable_or_corrupt");
  }
  const imageMetadataRead = elapsedMs(metadataStart);

  const validationStart = performance.now();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const format = (metadata.format ?? "unknown").toLowerCase();
  const minDimension = Math.min(width, height);
  const byteSize = bytes.length;
  const thresholds = ARTWORK_QUALITY_THRESHOLDS;

  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(`unsupported_image_format:${format}`);
  }
  if (byteSize < thresholds.minByteSize || width <= 0 || height <= 0) {
    throw new Error(`image_unusable_thumbnail:${width}x${height}:${byteSize}`);
  }
  const dimensionValidation = elapsedMs(validationStart);

  const qualityStart = performance.now();
  const tier: ArtworkQualityTier =
    minDimension >= thresholds.archiveMinDimension
      ? "archive"
      : minDimension >= thresholds.usableMinDimension
        ? "usable"
        : "unusable";

  const message =
    tier === "archive"
      ? "Archive-quality artwork."
      : tier === "usable"
        ? "Archive source is lower resolution than preferred."
        : "Artwork source is too small for restoration.";
  const qualityAssessment = elapsedMs(qualityStart);

  return {
    tier,
    width,
    height,
    format,
    byteSize,
    sourceUrl,
    thresholds,
    message,
    timings: {
      image_metadata_read: imageMetadataRead,
      dimension_validation: dimensionValidation,
      quality_assessment: qualityAssessment,
    },
  };
}
