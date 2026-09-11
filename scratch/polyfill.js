import fetch, { Request, Response, Headers } from "node-fetch";

globalThis.fetch = fetch;
globalThis.Request = Request;
globalThis.Response = Response;
globalThis.Headers = Headers;

if (!Response.json) {
  Response.json = (data, init = {}) => {
    const body = JSON.stringify(data);
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new Response(body, { ...init, headers });
  };
}
