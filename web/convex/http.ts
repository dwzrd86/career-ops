import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Convex Auth owns the provider endpoints used by password, reset, and verification flows.
auth.addHttpRoutes(http);

export default http;
