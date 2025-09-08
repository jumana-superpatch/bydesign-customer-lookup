/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// export default {
// 	async fetch(request, env, ctx) {
// 		return new Response('Hello World!');
// 	},
// };
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*", // allow all headers
        },
      });
    }

    try {
      // Parse query param
      const url = new URL(request.url);
      const email = url.searchParams.get("email");

      if (!email) {
        return new Response(
          JSON.stringify({ exists: false, error: "Missing email" }, null, 2),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Call ByDesign API
      const byDesignResp = await fetch(
        "https://webapi.securefreedom.com/VoxxLife/api/users/customer/CustomerLookup",
        {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Authorization": `Basic ${env.BYDESIGN_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ Email: email }),
        }
      );

      const byDesignData = await byDesignResp.json();
      const exists =
        Array.isArray(byDesignData) &&
        byDesignData.some((c) => c.Email === email);

      const customer = exists
        ? byDesignData.find((c) => c.Email === email)
        : null;

      return new Response(
        JSON.stringify(
          {
            exists,
            email,
            customer: customer || null,
          },
          null,
          2 // pretty print
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ exists: false, error: err.message }, null, 2),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};




