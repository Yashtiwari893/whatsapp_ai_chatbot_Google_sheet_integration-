import { google } from "googleapis";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/documents.readonly"],
});

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