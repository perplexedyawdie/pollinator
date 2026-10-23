import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface Storage {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  del(keys: string[]): Promise<void>;
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}
  private path(key: string) {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root))) throw new Error("Bad key");
    return full;
  }
  async put(key: string, body: string) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key), "utf8");
    } catch {
      return null;
    }
  }
  async del(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }
}

export class S3Storage implements Storage {
  private s3 = new S3Client({});
  constructor(private bucket: string) {}
  async put(key: string, body: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: "application/json" }));
  }
  async get(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (await res.Body?.transformToString("utf8")) ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
  async del(keys: string[]) {
    if (!keys.length) return;
    await this.s3.send(
      new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
    );
  }
}

export const localDataDir = (projectRoot: string) => join(projectRoot, ".data");
