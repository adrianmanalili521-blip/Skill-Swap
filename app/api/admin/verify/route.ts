function getTokenUid(token: string): string | null {
  const sections = token.split(".");
  if (sections.length !== 3) return null;

  try {
    const payload: unknown = JSON.parse(Buffer.from(sections[1], "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null || !("sub" in payload)) return null;
    const uid = payload.sub;
    return typeof uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i)?.[1];
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const uid = token ? getTokenUid(token) : null;

  if (!token || !uid) {
    return Response.json({ error: "A valid Firebase ID token is required." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!projectId) {
    console.error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured for admin verification.");
    return Response.json({ error: "Admin verification is not configured." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!response.ok) {
      return Response.json({ error: "Firebase could not authorize this account." }, {
        status: response.status === 401 ? 401 : 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const profile: unknown = await response.json();
    if (typeof profile !== "object" || profile === null || !("fields" in profile)) {
      return Response.json({ error: "Administrator profile is missing." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const fields = profile.fields;
    if (typeof fields !== "object" || fields === null) {
      return Response.json({ error: "Administrator profile is invalid." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const role = "role" in fields && typeof fields.role === "object" && fields.role !== null
      && "stringValue" in fields.role ? fields.role.stringValue : null;
    const status = "status" in fields && typeof fields.status === "object" && fields.status !== null
      && "stringValue" in fields.status ? fields.status.stringValue : "active";
    if (role !== "admin" || status !== "active") {
      return Response.json({ error: "Active administrator access is required." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ authorized: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to verify administrator access with Firestore.", error);
    return Response.json({ error: "Admin verification service is unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
