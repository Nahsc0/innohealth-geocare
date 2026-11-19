CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS geog geography(Point,4326)
 GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS facilities_geo ON facilities USING GIST(geog);
