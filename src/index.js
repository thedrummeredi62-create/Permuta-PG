export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/config.js") {
      const config = {
        SUPABASE_URL: env.SUPABASE_URL || "",
        SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || ""
      };

      return new Response(
        "window.PERMUTA_CONFIG = " + JSON.stringify(config) + ";",
        {
          headers: {
            "content-type": "application/javascript; charset=UTF-8",
            "cache-control": "no-store"
          }
        }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
