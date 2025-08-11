import { auth } from "./auth";

export default async (req, res) => {
  const headers = new Headers(req.headers);
  console.log("Auth /Hasura endpoint hit with headers:", headers);

  const session = await auth.api.getSession({ headers });
  console.log("Auth /Hasura endpoint hit with session:", session);

  if (!session) {
    if (process.env.HASURA_UNAUTHORIZED_ROLE)
      return res.json({
        "X-Hasura-Role": process.env.HASURA_UNAUTHORIZED_ROLE,
      });
    else return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({
    "X-Hasura-User-Id": session.user.id,
    "X-Hasura-Role": session.user.role,
  });
};
