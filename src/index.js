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
          { exists: false, foundIn: null, customer: null, error: "Missing email" },
          400
        );
      }

      console.log(`Looking up email: ${email}`);

      // 1. Check in Shopify
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
          customer: {
            id: shopifyCustomer.id,
            email: shopifyCustomer.email,
            firstName: shopifyCustomer.firstName,
            lastName: shopifyCustomer.lastName,
            metafields: shopifyCustomer.metafields,
            address: shopifyCustomer.defaultAddress
              ? {
                  address1: shopifyCustomer.defaultAddress.address1,
                  city: shopifyCustomer.defaultAddress.city,
                  province: shopifyCustomer.defaultAddress.province,
                  country: shopifyCustomer.defaultAddress.country,
                  zip: shopifyCustomer.defaultAddress.zip,
                  firstName: shopifyCustomer.defaultAddress.firstName,
                  lastName: shopifyCustomer.defaultAddress.lastName,
                }
              : null,
          },
        });
      }

      // 2. If not in Shopify, check ByDesign
      const byDesignCustomer = await findCustomerInByDesign(
        email,
        env.BYDESIGN_BASE,
        env.BYDESIGN_API_KEY
      );

      if (byDesignCustomer) {
        console.log("Found in ByDesign:", byDesignCustomer.Email);

        const createdCustomer = await createCustomerInShopify(
          byDesignCustomer,
          env.SHOPIFY_SHOP,
          env.SHAPETECH_API_KEY
        );

        let normalizedAddress = null;
        if (
          byDesignCustomer.ShipStreet1 &&
          byDesignCustomer.ShipCity &&
          byDesignCustomer.ShipState &&
          byDesignCustomer.ShipCountry &&
          byDesignCustomer.ShipPostalCode
        ) {
          normalizedAddress = {
            address1: byDesignCustomer.ShipStreet1,
            city: byDesignCustomer.ShipCity,
            province: byDesignCustomer.ShipState,
            country: byDesignCustomer.ShipCountry,
            zip: byDesignCustomer.ShipPostalCode,
            firstName: byDesignCustomer.FirstName,
            lastName: byDesignCustomer.LastName,
          };
        }

        return jsonResponse({
          exists: true,
          foundIn: "bydesign",
          customer: {
            id: createdCustomer?.id || null,
            email: byDesignCustomer.Email,
            firstName: byDesignCustomer.FirstName,
            lastName: byDesignCustomer.LastName,
            metafields: createdCustomer?.metafields || null,
            address: normalizedAddress,
          },
          createdInShopify: createdCustomer,
        });
      }

      // 3. Not found anywhere
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
  const query = `
    query customersByEmail($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            email
            firstName
            lastName
            defaultAddress {
              address1
              city
              province
              country
              zip
              firstName
              lastName
            }
            metafields(namespace: "external", first: 5) {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

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
  const res = await fetch(`${base}/VoxxLife/api/users/customer/CustomerLookup`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Email: email }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    return data.find((c) => c.Email?.toLowerCase() === email.toLowerCase()) || null;
  }
  return null;
}

// create customer in Shopify
async function createCustomerInShopify(customer, shop, token) {
  const mutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          email
          firstName
          lastName
          metafields(namespace: "external", first: 5) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const input = {
    email: customer.Email,
    firstName: customer.FirstName || "",
    lastName: customer.LastName || "",
    metafields: [
      {
        namespace: "external",
        key: "bydesign_id",
        type: "single_line_text_field",
        value: String(customer.CustomerDID || ""),
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
  if (json.data?.customerCreate?.userErrors?.length) {
    throw new Error(JSON.stringify(json.data.customerCreate.userErrors));
  }

  return json.data?.customerCreate?.customer || null;
}
