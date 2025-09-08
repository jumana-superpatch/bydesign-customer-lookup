export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");

    if (!email) {
      return new Response(JSON.stringify({ error: "Missing email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // STEP 1: Check in Shopify
      const shopifyResp = await fetch(
        `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/customers/search.json?query=email:${encodeURIComponent(
          email
        )}`,
        {
          headers: {
            "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      if (!shopifyResp.ok) {
        return new Response(
          JSON.stringify({
            exists: false,
            foundIn: null,
            customer: null,
            error: `Shopify lookup failed: ${shopifyResp.status}`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const shopifyData = await shopifyResp.json();
      if (shopifyData.customers && shopifyData.customers.length > 0) {
        return new Response(
          JSON.stringify({
            exists: true,
            foundIn: "shopify",
            customer: shopifyData.customers[0],
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // STEP 2: Check in ByDesign
      const bydesignResp = await fetch(
        `${env.BYDESIGN_API_URL}?email=${encodeURIComponent(email)}`,
        {
          headers: { Authorization: `Bearer ${env.SHAPETECH_API_KEY}` },
        }
      );

      if (!bydesignResp.ok) {
        return new Response(
          JSON.stringify({
            exists: false,
            foundIn: null,
            customer: null,
            error: `ByDesign lookup failed: ${bydesignResp.status}`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const bydesignData = await bydesignResp.json();
      if (!bydesignData || !bydesignData.CustomerID) {
        return new Response(
          JSON.stringify({
            exists: false,
            foundIn: null,
            customer: null,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // STEP 3: Build Shopify payload
      const shopifyCustomerPayload = {
        customer: {
          first_name: bydesignData.FirstName || "",
          last_name: bydesignData.LastName || "",
          email: bydesignData.Email,
          phone: bydesignData.Phone1 || null,
          addresses: [
            {
              address1: bydesignData.ShipStreet1 || bydesignData.BillStreet1,
              city: bydesignData.ShipCity || bydesignData.BillCity,
              province: bydesignData.ShipState || bydesignData.BillState,
              zip: bydesignData.ShipPostalCode || bydesignData.BillPostalCode,
              country: bydesignData.ShipCountry || bydesignData.BillCountry,
            },
          ],
          note: `Imported from ByDesign (CustomerID: ${bydesignData.CustomerID})`,
        },
      };

      // STEP 4: Create customer in Shopify
      const createResp = await fetch(
        `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/customers.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(shopifyCustomerPayload),
        }
      );

      if (!createResp.ok) {
        const errTxt = await createResp.text();
        return new Response(
          JSON.stringify({
            exists: true,
            foundIn: "bydesign",
            customer: bydesignData,
            createdInShopify: null,
            error: `Shopify create failed: ${createResp.status} ${errTxt}`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const createdCustomer = await createResp.json();

      // STEP 5: Return response
      return new Response(
        JSON.stringify({
          exists: true,
          foundIn: "bydesign",
          customer: bydesignData,
          createdInShopify: createdCustomer.customer,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
