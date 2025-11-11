import Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

export type GeometryFeature = Feature<Geometry>;
export type GeometrySource = VectorSource<GeometryFeature>;
export type GeometryLayer = VectorLayer<GeometrySource>;
