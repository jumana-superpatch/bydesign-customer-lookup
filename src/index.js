export default {
  async fetch(request, env) {
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

      // === CASE 2: REP LOOKUP ===
      const defaultRepData = {
        RepDID: "111115011",
        DisplayName: "Super Patch",
        DisplayNameHeader: "Super P.",
        FirstName: "Super",
        LastName: "Patch",
        ShouldAskToSwitch: false,
        ReplicatedSiteUrl: "www",
      };

      if (url.pathname === "/lookup-rep") {
        const rep = url.searchParams.get("rep");

        // If no rep param → return default
        if (!rep) {
          return jsonResponse(defaultRepData);
        }

        return fetch(
          `${env.BYDESIGN_BASE}/VoxxLife/api/User/Rep/${encodeURIComponent(rep)}/info`,
          {
            headers: {
              Authorization: `Basic ${env.BYDESIGN_API_KEY}`,
              Accept: "application/json",
            },
          }
        )
          .then((r) => r.json())
          .then(({ RepDID }) => {
            if (!RepDID) return defaultRepData;

            return fetch(
              `${env.BYDESIGN_BASE}/VoxxLife/api/rep/PublicInfo/GetInfo?repDID=${encodeURIComponent(RepDID)}`,
              {
                headers: {
                  Authorization: `Basic ${env.BYDESIGN_API_KEY}`,
                  Accept: "application/json",
                },
              }
            )
              .then((r) => r.json())
              .then(
                ({
                  RepDID,
                  DisplayName,
                  DisplayNameHeader,
                  FirstName,
                  LastName,
                  ShouldAskToSwitch,
                  ReplicatedSiteUrl,
                }) => ({
                  RepDID,
                  DisplayName,
                  DisplayNameHeader,
                  FirstName,
                  LastName,
                  ShouldAskToSwitch,
                  ReplicatedSiteUrl,
                })
              )
              .catch(() => defaultRepData);
          })
          .then((finalData) => jsonResponse(finalData))
          .catch(() => jsonResponse(defaultRepData));
      }

      // Unknown endpoint
      return jsonResponse({ error: "Unknown endpoint" }, 404);
    } catch (err) {
      console.error("Worker error:", err.message);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

// ---------- Helpers ----------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
