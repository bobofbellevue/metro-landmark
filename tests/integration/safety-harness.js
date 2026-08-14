export function requireProdTestOptIn() {
  if (process.env.ALLOW_PROD_TEST !== "true") {
    throw new Error("Set ALLOW_PROD_TEST=true to run integration tests against prod.");
  }
}

export function createSafetyContext({ prefix, tag }) {
  if (!prefix || typeof prefix !== "string" || !prefix.endsWith("-")) {
    throw new Error("Safety context requires a non-empty prefix ending with '-'.");
  }

  if (!tag || typeof tag !== "string") {
    throw new Error("Safety context requires a non-empty tag.");
  }

  const likePrefix = `${prefix}%`;

  const email = (localPart, domain = "test.com") => `${prefix}${localPart}@${domain}`;
  const fileName = (name) => `${prefix}${name}`;
  const taggedText = (text) => `${tag} ${text}`;

  return {
    prefix,
    tag,
    likePrefix,
    email,
    fileName,
    taggedText
  };
}

export async function cleanupStorageByPrefix(supabase, bucketName, prefix) {
  const { data: files } = await supabase.storage.from(bucketName).list();
  const targetPaths = (files || [])
    .filter(file => file.name.startsWith(prefix))
    .map(file => file.name);

  if (targetPaths.length > 0) {
    await supabase.storage.from(bucketName).remove(targetPaths);
  }
}

export async function cleanupUsersByEmailPrefix(supabase, prefix) {
  const { data: users } = await supabase
    .from("users")
    .select("user_id")
    .ilike("email", `${prefix}%`);

  const userIds = (users || []).map(user => user.user_id);
  if (userIds.length > 0) {
    await supabase.from("users").delete().in("user_id", userIds);
  }
}
