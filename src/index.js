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
        console.log("Missing email");
        return jsonResponse(
          { exists: false, foundIn: null, customer: null, error: "Missing email" },
          400
        );
      }

      console.log("Looking up email:", email);

      // 1) Check Shopify
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

      // 2) Check ByDesign
      const byDesignCustomer = await findCustomerInByDesign(
        email,
        env.BYDESIGN_BASE,
        env.BYDESIGN_API_KEY
      );

      if (byDesignCustomer) {
        console.log("Found in ByDesign:", byDesignCustomer.Email);

        // 3) Create in Shopify with addresses (shipping + billing if available)
        const createdCustomer = await createCustomerInShopify(
          byDesignCustomer,
          env.SHOPIFY_SHOP,
          env.SHAPETECH_API_KEY
        );

        console.log("Created in Shopify:", createdCustomer?.email);

        return jsonResponse({
          exists: true,
          foundIn: "bydesign",
          customer: byDesignCustomer,
          createdInShopify: createdCustomer,
        });
      }

      // 4) Not found
      console.log("Not found in Shopify or ByDesign");
      return jsonResponse({ exists: false, foundIn: null, customer: null });
    } catch (err) {
      console.error("Worker error:", err?.message || String(err));
      return jsonResponse(
        { exists: false, foundIn: null, customer: null, error: err?.message || String(err) },
        500
      );
    }
  },
};

/* ---------------- Helpers ---------------- */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

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
  console.log("Shopify lookup response:", JSON.stringify(json, null, 2));
  return json.data?.customers?.edges?.[0]?.node || null;
}

async function findCustomerInByDesign(email, base, apiKey) {
  const url = `${base}/VoxxLife/api/users/customer/CustomerLookup`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Email: email }),
  });

  if (!res.ok) {
    console.error("ByDesign lookup failed:", res.status);
    return null;
  }

  const data = await res.json();
  console.log("ByDesign lookup response:", JSON.stringify(data, null, 2));

  if (Array.isArray(data) && data.length > 0) {
    return data.find((c) => (c.Email || "").toLowerCase() === email.toLowerCase()) || null;
  }
  return null;
}

/* ---- Address mapping helpers ---- */

function compact(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  });
  return out;
}

function countryToCodeV2(str) {
  if (!str) return undefined;
  const s = String(str).trim().toUpperCase();
  if (s === "CANADA" || s === "CA") return "CA";
  if (s === "UNITED STATES" || s === "USA" || s === "US") return "US";
  return undefined;
}

function buildShippingAddress(bd) {
  const anyShip =
    bd.ShipStreet1 || bd.ShipCity || bd.ShipState || bd.ShipPostalCode || bd.ShipCountry;
  if (!anyShip) return undefined;

  return compact({
    firstName: bd.FirstName,
    lastName: bd.LastName,
    address1: bd.ShipStreet1,
    address2: bd.ShipStreet2,
    city: bd.ShipCity,
    provinceCode: bd.ShipState,
    zip: bd.ShipPostalCode,
    countryCodeV2: countryToCodeV2(bd.ShipCountry),
    phone: bd.Phone1,
  });
}

function buildBillingAddress(bd) {
  const anyBill =
    bd.BillStreet1 || bd.BillCity || bd.BillState || bd.BillPostalCode || bd.BillCountry;
  if (!anyBill) return undefined;

  return compact({
    firstName: bd.FirstName,
    lastName: bd.LastName,
    address1: bd.BillStreet1,
    address2: bd.BillStreet2,
    city: bd.BillCity,
    provinceCode: bd.BillState,
    zip: bd.BillPostalCode,
    countryCodeV2: countryToCodeV2(bd.BillCountry),
    phone: bd.Phone1,
  });
}

function addressesEqual(a, b) {
  if (!a || !b) return false;
  const key = (x) =>
    [x.address1, x.address2, x.city, x.provinceCode, x.zip, x.countryCodeV2]
      .map((v) => (v || "").toUpperCase())
      .join("|");
  return key(a) === key(b);
}

/* ---- Create customer (with addresses) ---- */

async function createCustomerInShopify(bdCustomer, shop, token) {
  const shipping = buildShippingAddress(bdCustomer);
  const billing = buildBillingAddress(bdCustomer);

  const addresses = [];
  if (shipping) addresses.push(shipping);
  if (billing && !addressesEqual(billing, shipping)) addresses.push(billing);

  const mutation = `mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        email
        firstName
        lastName
        addresses {
          id
          address1
          address2
          city
          province
          provinceCode
          zip
          country
          countryCodeV2
          phone
        }
      }
      userErrors { field message }
    }
  }`;

  const input = compact({
    email: bdCustomer.Email,
    firstName: bdCustomer.FirstName,
    lastName: bdCustomer.LastName,
    phone: bdCustomer.Phone1,
    addresses: addresses.length ? addresses : undefined,
  });

  const res = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query: mutation, variables: { input } }),
  });

  const json = await res.json();
  console.log("Shopify create response:", JSON.stringify(json, null, 2));

  const errors = json.data?.customerCreate?.userErrors || [];
  if (errors.length) {
    throw new Error("Shopify create failed: " + JSON.stringify(errors));
  }

  const created = json.data?.customerCreate?.customer;

  // Set default address to shipping (first we sent), if present
  const firstAddrId = created?.addresses?.[0]?.id;
  if (created?.id && firstAddrId) {
    try {
      await setDefaultAddress(shop, token, created.id, firstAddrId);
    } catch (e) {
      console.error("Failed to set default address:", e?.message || String(e));
    }
  }

  return created || null;
}

async function setDefaultAddress(shop, token, customerId, addressId) {
  const mutation = `mutation customerDefaultAddressUpdate($customerId: ID!, $addressId: ID!) {
    customerDefaultAddressUpdate(customerId: $customerId, addressId: $addressId) {
      customer {
        id
        defaultAddress {
          id
          address1
          city
          countryCodeV2
        }
      }
      userErrors { field message }
    }
  }`;

  const res = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({
      query: mutation,
      variables: { customerId, addressId },
    }),
  });

  const json = await res.json();
  console.log("Set default address response:", JSON.stringify(json, null, 2));

  const errors = json.data?.customerDefaultAddressUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error("customerDefaultAddressUpdate failed: " + JSON.stringify(errors));
  }
}
