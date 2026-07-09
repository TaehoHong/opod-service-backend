export function publicMediaUrl(input: {
  url: string;
  storageKey?: string | null;
}): string {
  const url = input.url.trim();
  if (isHttpUrl(url)) {
    return url;
  }

  const baseUrl = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  const key = (input.storageKey?.trim() || url).replace(/^\/+/, "");
  if (!baseUrl || !key) {
    return url;
  }

  return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
