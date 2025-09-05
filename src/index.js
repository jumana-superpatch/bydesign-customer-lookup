export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    try {
      const { email, shopify_customer_id } = await request.json();
      if (!email || !shopify_customer_id) {
        return new Response(
          JSON.stringify({ success: false, message: "Missing email or shopify_customer_id" }),
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
      const customer = Array.isArray(byDesignData)
        ? byDesignData.find((c) => c.Email === email)
        : null;

      if (customer) {
        // Update Shopify Customer
        const shopifyResp = await fetch(
          `https://${env.SHOP}/admin/api/2025-01/customers/${shopify_customer_id}.json`,
          {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": env.SHOPIFY_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              customer: {
                id: shopify_customer_id,
                first_name: customer.FirstName,
                last_name: customer.LastName,
                phone: customer.Phone,
                email: customer.Email,
                addresses: [
                  {
                    address1: customer.Address1,
                    city: customer.City,
                    province: customer.State,
                    zip: customer.Zip,
                    country: customer.Country,
                  },
                ],
              },
            }),
          }
        );

        const shopifyResult = await shopifyResp.json();

        return new Response(
          JSON.stringify({ success: true, updated: true, shopify: shopifyResult }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Customer not found in ByDesign
      return new Response(
        JSON.stringify({ success: true, updated: false, message: "Customer not found in ByDesign" }),
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
        JSON.stringify({ success: false, error: err.message }),
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
