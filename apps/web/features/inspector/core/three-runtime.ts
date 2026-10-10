import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ColorEnvironment } from "three/addons/environments/ColorEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";

/**
 * three-runtime — the only module that imports three.js and its addons. It is reached solely
 * through {@link ./three-loader.ts | `loadThree()`}'s dynamic import, so the engine stays out of
 * the server snapshot and out of every page that never opens a 3D file.
 */
const runtime = {
	THREE,
	OrbitControls,
	RoomEnvironment,
	ColorEnvironment,
	GLTFLoader,
	DRACOLoader,
	KTX2Loader,
	MeshoptDecoder,
	OBJLoader,
	STLLoader,
	PLYLoader,
	FBXLoader,
	ThreeMFLoader,
	ColladaLoader,
	USDLoader,
};

export default runtime;
