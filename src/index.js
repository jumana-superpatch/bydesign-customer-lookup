export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const email = url.searchParams.get("email");

    if (!email) {
      return jsonResponse({ error: "Missing email" }, 400);
    }

    try {
      console.log("Checking Shopify for:", email);

      // 1) Shopify lookup
      const shopifyResp = await fetch(
        `https://${env.SHOPIFY_SHOP}/admin/api/2025-01/customers/search.json?query=email:${encodeURIComponent(
          email
        )}`,
        {
          headers: {
            "X-Shopify-Access-Token": env.SHAPETECH_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Shopify status:", shopifyResp.status);

      if (!shopifyResp.ok) {
        return jsonResponse(
          { error: `Shopify lookup failed: ${shopifyResp.status}` },
          500
        );
      }

      const shopifyData = await shopifyResp.json();
      if (shopifyData.customers?.length > 0) {
        console.log("Found in Shopify");
        return jsonResponse({
          exists: true,
          foundIn: "shopify",
          customer: shopifyData.customers[0],
        });
      }

      // 2) ByDesign lookup
      console.log("Checking ByDesign for:", email);

      const bydesignResp = await fetch(
        `${env.BYDESIGN_BASE}/VoxxLife/api/users/customer/CustomerLookup`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${env.BYDESIGN_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ Email: email }),
        }
      );

      console.log("ByDesign status:", bydesignResp.status);

      if (!bydesignResp.ok) {
        const errTxt = await bydesignResp.text();
        console.log("ByDesign error body:", errTxt);
        return jsonResponse(
          { error: `ByDesign lookup failed: ${bydesignResp.status}` },
          500
        );
      }

      const bydesignData = await bydesignResp.json();
      console.log("ByDesign raw response:", bydesignData);

      if (!Array.isArray(bydesignData) || bydesignData.length === 0) {
        return jsonResponse({ exists: false, foundIn: null, customer: null });
      }

      const bdCustomer = bydesignData.find(
        (c) => c.Email?.toLowerCase() === email.toLowerCase()
      );
      if (!bdCustomer) {
        return jsonResponse({ exists: false, foundIn: null, customer: null });
      }

      // 3) Build Shopify payload
      const shopifyPayload = {
        customer: {
          first_name: bdCustomer.FirstName || "",
          last_name: bdCustomer.LastName || "",
          email: bdCustomer.Email,
          phone: bdCustomer.Phone1 || null,
          addresses: [
            {
              first_name: bdCustomer.FirstName || "",
              last_name: bdCustomer.LastName || "",
              address1: bdCustomer.ShipStreet1 || bdCustomer.BillStreet1,
              address2: bdCustomer.ShipStreet2 || bdCustomer.BillStreet2,
              city: bdCustomer.ShipCity || bdCustomer.BillCity,
              province: bdCustomer.ShipState || bdCustomer.BillState,
              zip: bdCustomer.ShipPostalCode || bdCustomer.BillPostalCode,
              country: bdCustomer.ShipCountry || bdCustomer.BillCountry,
              phone: bdCustomer.Phone1 || null,
            },
          ],
          note: `Imported from ByDesign (CustomerID: ${bdCustomer.CustomerID})`,
        },
      };

      console.log("Creating customer in Shopify with:", shopifyPayload);

      const createResp = await fetch(
        `https://${env.SHOPIFY_SHOP}/admin/api/2025-01/customers.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": env.SHAPETECH_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(shopifyPayload),
        }
      );

      console.log("Create Shopify status:", createResp.status);

      if (!createResp.ok) {
        const errTxt = await createResp.text();
        console.log("Shopify create error body:", errTxt);
        return jsonResponse(
          { error: `Shopify create failed: ${createResp.status}`, details: errTxt },
          500
        );
      }

      const createdCustomer = await createResp.json();
      console.log("Customer created in Shopify:", createdCustomer);

      return jsonResponse({
        exists: true,
        foundIn: "bydesign",
        customer: bdCustomer,
        createdInShopify: createdCustomer.customer,
      });
    } catch (err) {
      console.log("Fatal error:", err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

/* ---- Utility ---- */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
