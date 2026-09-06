import { describe, expect, it } from "vitest";
import {
  type Credentials,
  loadCredentials,
  verifyCredentials,
} from "./basic-auth";

/** テスト用に Basic 認証ヘッダを組み立てる */
function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const expected: Credentials = { user: "alice", password: "s3cret" };

describe("verifyCredentials", () => {
  it("正しい認証情報を伴うヘッダを受け取ると真を返す", () => {
    expect(verifyCredentials(basicHeader("alice", "s3cret"), expected)).toBe(
      true,
    );
  });

  it("ヘッダが無い場合は偽を返す", () => {
    expect(verifyCredentials(null, expected)).toBe(false);
  });

  it("パスワードが異なる場合は偽を返す", () => {
    expect(verifyCredentials(basicHeader("alice", "wrong"), expected)).toBe(
      false,
    );
  });

  it("形式が不正な値を受け取っても例外を投げず偽を返す", () => {
    // Basic で始まらない / 復号できない / 区切りが無い、のいずれも偽に集約する
    expect(verifyCredentials("Bearer token", expected)).toBe(false);
    expect(verifyCredentials("Basic !!!not-base64!!!", expected)).toBe(false);
    expect(
      verifyCredentials(
        `Basic ${Buffer.from("no-colon").toString("base64")}`,
        expected,
      ),
    ).toBe(false);
    expect(verifyCredentials("", expected)).toBe(false);
  });
});

describe("loadCredentials", () => {
  it("2 つの変数が揃っていれば認証情報を返す", () => {
    const result = loadCredentials({
      BASIC_AUTH_USER: "alice",
      BASIC_AUTH_PASSWORD: "s3cret",
    });
    expect(result).toEqual({ user: "alice", password: "s3cret" });
  });

  it("変数が欠けている場合は未設定として null を返す", () => {
    // 両方欠ける / 片方だけ / 空文字、のいずれも未設定として扱う
    expect(loadCredentials({})).toBeNull();
    expect(loadCredentials({ BASIC_AUTH_USER: "alice" })).toBeNull();
    expect(loadCredentials({ BASIC_AUTH_PASSWORD: "s3cret" })).toBeNull();
    expect(
      loadCredentials({ BASIC_AUTH_USER: "", BASIC_AUTH_PASSWORD: "s3cret" }),
    ).toBeNull();
  });
});
