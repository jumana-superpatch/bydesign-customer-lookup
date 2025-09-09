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
        console.log("⚠️ useEmail returned undefined");
        return jsonResponse(
          { exists: false, foundIn: null, customer: null, error: "Missing email" },
          400
        );
      }

      console.log(`Looking up email: ${email}`);

      // 1️ Check in Shopify
      const shopifyCustomer = await findCustomerInShopify(
        email,
        env.SHOPIFY_SHOP,
        env.SHAPETECH_API_KEY
      );

      if (shopifyCustomer) {
        console.log("Found in Shopify:", shopifyCustomer.email);
        return jsonResponse({
          exists: true,
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
        console.log("Found in ByDesign:", byDesignCustomer.Email);

        // 3️ Auto-create in Shopify (basic)
        const createdCustomer = await createCustomerInShopify(
          byDesignCustomer,
          env.SHOPIFY_SHOP,
          env.SHAPETECH_API_KEY
        );

        console.log("Created in Shopify:", createdCustomer?.email);

        let addressesCreated = [];

        // 4️ Create addresses
        if (createdCustomer?.id) {
          // Billing Address
          if (
            byDesignCustomer.BillStreet1 &&
            byDesignCustomer.BillCity &&
            byDesignCustomer.BillState &&
            byDesignCustomer.BillCountry &&
            byDesignCustomer.BillPostalCode
          ) {
            const billingAddress = {
              address1: byDesignCustomer.BillStreet1,
              city: byDesignCustomer.BillCity,
              province: byDesignCustomer.BillState,
              country: byDesignCustomer.BillCountry,
              zip: byDesignCustomer.BillPostalCode,
              firstName: byDesignCustomer.FirstName,
              lastName: byDesignCustomer.LastName,
              // phone omitted to avoid errors
            };

            const addr = await createCustomerAddressInShopify(
              createdCustomer.id,
              billingAddress,
              env.SHOPIFY_SHOP,
              env.SHAPETECH_API_KEY,
              true // set billing address as default
            );
            addressesCreated.push(addr);
          }

          // Shipping Address (only if different from billing)
          if (
            byDesignCustomer.ShipStreet1 &&
            byDesignCustomer.ShipCity &&
            byDesignCustomer.ShipState &&
            byDesignCustomer.ShipCountry &&
            byDesignCustomer.ShipPostalCode &&
            byDesignCustomer.ShipStreet1 !== byDesignCustomer.BillStreet1
          ) {
            const shippingAddress = {
              address1: byDesignCustomer.ShipStreet1,
              city: byDesignCustomer.ShipCity,
              province: byDesignCustomer.ShipState,
              country: byDesignCustomer.ShipCountry,
              zip: byDesignCustomer.ShipPostalCode,
              firstName: byDesignCustomer.FirstName,
              lastName: byDesignCustomer.LastName,
            };

            const addr = await createCustomerAddressInShopify(
              createdCustomer.id,
              shippingAddress,
              env.SHOPIFY_SHOP,
              env.SHAPETECH_API_KEY,
              false
            );
            addressesCreated.push(addr);
          }
        }

        return jsonResponse({
          exists: true,
          foundIn: "bydesign",
          customer: byDesignCustomer,
          createdInShopify: createdCustomer,
          addressesCreated,
        });
      }

      // 5️ Not found anywhere
      console.log("Not found in Shopify or ByDesign");
      return jsonResponse({ exists: false, foundIn: null, customer: null });
    } catch (err) {
      console.error("Worker error:", err.message);
      return jsonResponse(
        { exists: false, foundIn: null, customer: null, error: err.message },
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

  if (!res.ok) {
    throw new Error(`Shopify lookup failed: ${res.status}`);
  }

  const json = await res.json();
  console.log("🔎 Shopify lookup response:", JSON.stringify(json, null, 2));
  return json.data?.customers?.edges?.[0]?.node || null;
}

// find customer in ByDesign
async function findCustomerInByDesign(email, base, apiKey) {
  const res = await fetch(`${base}/VoxxLifeSandbox/api/users/customer/CustomerLookup`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Email: email }),
  });

  if (!res.ok) {
    console.error("❌ ByDesign lookup failed:", res.status);
    return null;
  }

  const data = await res.json();
  console.log("🔎 ByDesign lookup response:", JSON.stringify(data, null, 2));

  if (Array.isArray(data) && data.length > 0) {
    return data.find((c) => c.Email?.toLowerCase() === email.toLowerCase()) || null;
  }
  return null;
}

// create customer in Shopify (basic customerCreate)
async function createCustomerInShopify(customer, shop, token) {
  const mutation = `mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { 
        id 
        email 
        firstName 
        lastName
        metafields(namespace: "external", first: 5) {
          edges { node { namespace key value } }
        }
      }
      userErrors { field message }
    }
  }`;

  const input = {
    email: customer.Email,
    firstName: customer.FirstName || "",
    lastName: customer.LastName || "",
    metafields: [
      {
        namespace: "external",
        key: "bydesign_id",
        type: "single_line_text_field",
        value: String(customer.CustomerID), // your ByDesign ID
      },
    ],
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
  console.log("📝 Shopify create response:", JSON.stringify(json, null, 2));

  if (json.data?.customerCreate?.userErrors?.length) {
    throw new Error(
      "Shopify create failed: " +
        JSON.stringify(json.data.customerCreate.userErrors)
    );
  }

  return json.data?.customerCreate?.customer || null;
}

// create address in Shopify (Admin API customerAddressCreate)
async function createCustomerAddressInShopify(customerId, address, shop, token, setAsDefault = false) {
 const mutation = `
  mutation customerAddressCreate($customerId: ID!, $address: MailingAddressInput!, $setAsDefault: Boolean) {
    customerAddressCreate(customerId: $customerId, address: $address, setAsDefault: $setAsDefault) {
      address {
        id
        address1
        city
        province
        country
        zip
        firstName
        lastName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const variables = { customerId, address, setAsDefault };

const res = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  },
  body: JSON.stringify({ query: mutation, variables }),
});

const json = await res.json();
console.log("📝 Shopify address create response:", JSON.stringify(json, null, 2));

if (json.data?.customerAddressCreate?.userErrors?.length) {
  throw new Error(
    "Shopify address create failed: " +
    JSON.stringify(json.data.customerAddressCreate.userErrors)
  );
}

return json.data?.customerAddressCreate?.address || null;

}
