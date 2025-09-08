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
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    try {
      const url = new URL(request.url);
      const email = url.searchParams.get("email");

      if (!email) {
        return jsonResponse(
          { foundIn: null, error: "Missing email" },
          400
        );
      }

      // 1️ Check in Shopify
      const shopifyCustomer = await findCustomerInShopify(
        email,
        env.SHOPIFY_SHOP,
        env.SHOPIFY_API_KEY
      );
      if (shopifyCustomer) {
        return jsonResponse({
          foundIn: "shopify",
          customer: shopifyCustomer,
        });
      }

      // 2️ If not in Shopify, check ByDesign
      const byDesignCustomer = await findCustomerInByDesign(
        email,
        env.BYDESIGN_BASE,
        env.BYDESIGN_API_KEY
      );
      if (byDesignCustomer) {
        // 3️ Auto-create customer in Shopify
        const createdCustomer = await createCustomerInShopify(
          byDesignCustomer,
          env.SHOPIFY_SHOP,
          env.SHOPIFY_API_KEY
        );

        return jsonResponse({
          foundIn: "bydesign",
          customer: byDesignCustomer,
          createdInShopify: createdCustomer,
        });
      }

      // 4️ Not found anywhere
      return jsonResponse({ foundIn: null, customer: null });
    } catch (err) {
      return jsonResponse(
        { foundIn: null, error: err.message },
        500
      );
    }
  },
};

// ---------- Helpers ----------

// send JSON with CORS
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// find customer in Shopify
async function findCustomerInShopify(email, shop, token) {
  const query = `query customersByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          email
          firstName
          lastName
        }
      }
    }
  }`;

  const res = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables: { query: `email:${email}` } }),
  });

  if (!res.ok) throw new Error(`Shopify lookup failed: ${res.status}`);
  const json = await res.json();
  return json.data?.customers?.edges?.[0]?.node || null;
}

// find customer in ByDesign
async function findCustomerInByDesign(email, base, apiKey) {
  const res = await fetch(
    `${base}/VoxxLife/api/users/customer/CustomerLookup`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Email: email }),
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    return data.find((c) => c.Email === email) || null;
  }
  return null;
}

// create customer in Shopify
async function createCustomerInShopify(customer, shop, token) {
  const mutation = `mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id email firstName lastName }
      userErrors { field message }
    }
  }`;

  const input = {
    email: customer.Email,
    firstName: customer.FirstName || "",
    lastName: customer.LastName || "",
    phone: customer.Phone || null,
  };

  const res = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });

  const json = await res.json();
  if (json.data?.customerCreate?.userErrors?.length) {
    throw new Error(
      "Shopify create failed: " +
        JSON.stringify(json.data.customerCreate.userErrors)
    );
  }
  return json.data?.customerCreate?.customer || null;
}





