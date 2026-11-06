// Captures (capture-design.md §7): the browser uploads straight to S3 under pending/ with presigned POST
// policies; confirm checks each file, re-sanitises the page copy on the server and moves the files to
// their final keys. Viewing is by 5-minute presigned GET after the thread's visibility check.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type Capture, type CaptureFile, HttpError, LIMITS } from "@annotatie/core";
import { parseHTML } from "linkedom";

export const FILES: Record<CaptureFile, { name: string; type: string; max: number; encoding?: string }> = {
  page: { name: "page.webp", type: "image/webp", max: LIMITS.screenshot },
  pageMarked: { name: "page-marked.webp", type: "image/webp", max: LIMITS.screenshot },
  closeup: { name: "closeup.webp", type: "image/webp", max: LIMITS.closeup },
  html: { name: "page.html.gz", type: "text/html", max: LIMITS.pageHtmlGz, encoding: "gzip" },
};

export interface CaptureStore {
  uploadPolicies(siteId: string, itemId: string, files: CaptureFile[]): Promise<Record<string, { url: string; fields: Record<string, string> }>>;
  confirm(siteId: string, itemId: string, claimed: Record<string, { size: number; sha256: string }>): Promise<{ files: Capture["files"]; notes: string[] }>;
  viewUrl(siteId: string, itemId: string, file: CaptureFile): Promise<string>;
  html(siteId: string, itemId: string): Promise<Buffer>;
  /** The stored bytes of one confirmed file (the MCP server returns images inline). */
  bytes(siteId: string, itemId: string, file: CaptureFile): Promise<Buffer>;
  purge(siteId: string, itemId: string): Promise<void>;
}

const key = (siteId: string, itemId: string, file: CaptureFile, pending = false) =>
  `${pending ? "pending/" : ""}sites/${siteId}/items/${itemId}/capture/${FILES[file].name}`;

export function s3Captures(bucket: string, s3 = new S3Client({})): CaptureStore {
  return {
    async uploadPolicies(siteId, itemId, files) {
      const out: Record<string, { url: string; fields: Record<string, string> }> = {};
      for (const f of files) {
        const spec = FILES[f];
        const fields: Record<string, string> = { "Content-Type": spec.type, ...(spec.encoding ? { "Content-Encoding": spec.encoding } : {}) };
        const post = await createPresignedPost(s3, {
          Bucket: bucket,
          Key: key(siteId, itemId, f, true),
          Conditions: [
            ["content-length-range", 1, spec.max],
            ["eq", "$Content-Type", spec.type],
            ...(spec.encoding ? [{ "Content-Encoding": spec.encoding }] : []),
          ],
          Fields: fields,
          Expires: 600,
        });
        out[f] = { url: post.url, fields: post.fields };
      }
      return out;
    },

    async confirm(siteId, itemId, claimed) {
      const files: Capture["files"] = {};
      const notes: string[] = [];
      for (const [name, c] of Object.entries(claimed)) {
        if (!(name in FILES)) continue;
        const f = name as CaptureFile;
        const pk = key(siteId, itemId, f, true);
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: pk }));
          if (head.ContentLength !== c.size || (head.ContentLength ?? 0) > FILES[f].max) {
            notes.push(`${f}: size did not match, left out`);
            continue;
          }
          const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: pk }));
          const bytes = Buffer.from(await obj.Body!.transformToByteArray());
          const hash = createHash("sha256").update(bytes).digest();
          if (hash.toString("hex") !== c.sha256.toLowerCase() && hash.toString("base64url") !== c.sha256 && hash.toString("base64") !== c.sha256) {
            notes.push(`${f}: checksum did not match, left out`);
            continue;
          }
          if (f === "html") {
            const clean = gzipSync(Buffer.from(sanitisePageCopy(gunzipSync(bytes, { maxOutputLength: 40 * 1024 * 1024 }).toString("utf8")), "utf8"));
            await s3.send(
              new PutObjectCommand({ Bucket: bucket, Key: key(siteId, itemId, f), Body: clean, ContentType: "text/html; charset=utf-8", ContentEncoding: "gzip" }),
            );
            files[f] = { size: clean.length };
          } else {
            if (!isWebp(bytes)) {
              notes.push(`${f}: not a WebP image, left out`);
              continue;
            }
            await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: key(siteId, itemId, f), CopySource: `${bucket}/${pk}`, ContentType: FILES[f].type, MetadataDirective: "REPLACE" }));
            files[f] = { size: bytes.length };
          }
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: pk }));
        } catch (e) {
          const n = (e as { name?: string }).name;
          notes.push(n === "NotFound" || n === "NoSuchKey" ? `${f}: never arrived` : `${f}: could not be checked`);
          if (n !== "NotFound" && n !== "NoSuchKey") console.warn(JSON.stringify({ msg: "capture confirm", file: f, error: String(e) }));
        }
      }
      return { files, notes };
    },

    async viewUrl(siteId, itemId, file) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key(siteId, itemId, file), ResponseCacheControl: "private, max-age=300" }), { expiresIn: 300 });
    },

    async html(siteId, itemId) {
      return this.bytes(siteId, itemId, "html");
    },

    async bytes(siteId, itemId, file) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(siteId, itemId, file) }));
      return Buffer.from(await obj.Body!.transformToByteArray());
    },

    async purge(siteId, itemId) {
      const prefix = `sites/${siteId}/items/${itemId}/`;
      const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      const objs = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objs.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs } }));
    },
  };
}

function isWebp(b: Buffer): boolean {
  return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}

const DROP = "script, iframe, frame, frameset, object, embed, base, link, meta[http-equiv], applet, portal, noscript, template[shadowrootmode]";
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "srcset", "data", "ping", "cite"];

/** Server-side re-sanitising of a page copy (capture-design.md §7). Scripts and handlers never survive. */
export function sanitisePageCopy(html: string): string {
  const { document } = parseHTML(html.startsWith("<!") || /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head></head><body>${html}</body></html>`);
  for (const el of [...document.querySelectorAll(DROP)]) el.remove();
  for (const el of [...document.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      const v = attr.value.trim().toLowerCase().replace(/[\s\u0000-\u001f]+/g, "");
      if (n.startsWith("on") || n === "srcdoc" || n === "formaction") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.includes(n)) {
        const bad = v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html") || v.startsWith("data:image/svg") || (n !== "src" && v.startsWith("data:"));
        const external = /^(https?:)?\/\//.test(v);
        if (bad || (n === "src" && external) || n === "srcset" || n === "ping") el.removeAttribute(attr.name);
      }
      if (n === "style" && /url\s*\(\s*['"]?\s*(javascript|https?:|\/\/)/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  for (const st of [...document.querySelectorAll("style")]) {
    st.textContent = (st.textContent ?? "").replace(/@import[^;]+;?/gi, "").replace(/url\s*\(\s*['"]?\s*(?:https?:|\/\/|javascript:)[^)]*\)/gi, "none");
  }
  const root = document.documentElement;
  return `<!doctype html>\n${root ? root.outerHTML : document.toString()}`;
}
