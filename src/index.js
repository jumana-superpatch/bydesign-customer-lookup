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
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const { email } = await request.json();
      if (!email) {
        return new Response(JSON.stringify({ success: false, message: "Missing email" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Call ByDesign
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
      const exists = Array.isArray(byDesignData) && byDesignData.some(c => c.Email === email);

      const customer = exists ? byDesignData.find(c => c.Email === email) : null;

      // Standardized response
      return new Response(
        JSON.stringify({
          success: true,
          exists,
          customer: customer || null,
          message: exists ? "Customer found" : "Customer not found",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, message: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};

