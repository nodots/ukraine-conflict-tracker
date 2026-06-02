-- Widen the derived contact line to MultiLineString: real fronts are
-- discontinuous (separate segments / occupied pockets) and PostGIS rejects a
-- MultiLineString in a LineString-typed column. Existing LineString rows are
-- cast up via ST_Multi.
ALTER TABLE "frontlines"
  ALTER COLUMN "geom" TYPE geography(MultiLineString, 4326)
  USING ST_Multi("geom"::geometry)::geography;
