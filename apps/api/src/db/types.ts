import { customType } from "drizzle-orm/pg-core";

// PostGIS geography columns. Drizzle treats these as opaque; we read/write the
// geometry via ST_AsGeoJSON / ST_GeomFromGeoJSON in raw SQL where needed.

export const geographyPoint = customType<{
  data: { lat: number; lon: number };
  driverData: string;
}>({
  dataType() {
    return "geography(Point, 4326)";
  },
});

export const geographyMultiPolygon = customType<{
  data: unknown;
  driverData: string;
}>({
  dataType() {
    return "geography(MultiPolygon, 4326)";
  },
});

// The derived contact line is genuinely discontinuous (separate front segments
// and occupied pockets), so it is stored as a MultiLineString.
export const geographyMultiLineString = customType<{
  data: unknown;
  driverData: string;
}>({
  dataType() {
    return "geography(MultiLineString, 4326)";
  },
});
