import { google } from "googleapis";
import createGoogleJwt from "./googleAuth";

const auth = createGoogleJwt(["https://www.googleapis.com/auth/documents.readonly"]);

export async function readGoogleDoc(docId: string): Promise<string> {
  const docs = google.docs({ version: "v1", auth });

  const res = await docs.documents.get({
    documentId: docId,
  });

  const content = res.data.body?.content || [];
  let text = "";

  for (const element of content) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements || []) {
        if (paragraphElement.textRun) {
          text += paragraphElement.textRun.content || "";
        }
      }
    }
  }

  return text.trim();
}

export async function getGoogleDocMetadata(docId: string) {
  const docs = google.docs({ version: "v1", auth });
  const res = await docs.documents.get({ documentId: docId });
  return {
    title: res.data.title || null,
    revisionId: (res.data.revisionId as string) || null,
  };
}