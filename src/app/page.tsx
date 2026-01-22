import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
    return (
        <main className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="border-b bg-white">
                <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold tracking-tight">
                        RAG WhatsApp Chatbot
                    </h1>

                    <Link href="/chat">
                        <Button variant="outline">Open Live Chat</Button>
                    </Link>
                </div>
            </header>

            {/* Hero */}
            <section className="max-w-6xl mx-auto px-6 py-12">
                <h2 className="text-3xl font-bold mb-2">
                    AI-Powered WhatsApp Automation 🚀
                </h2>
                <p className="text-gray-600 max-w-2xl">
                    Manage WhatsApp numbers, upload knowledge (PDF / Google Sheets),
                    and auto-reply to customers using your own data.
                </p>
            </section>

            {/* Dashboard Cards */}
            <section className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardCard
                    title="Phone Numbers"
                    desc="Manage WhatsApp business numbers & intents"
                    href="/files"
                    button="Manage"
                />

                <DashboardCard
                    title="Knowledge Base"
                    desc="PDFs, Images & Google Sheet data"
                    href="/files"
                    button="Open"
                />

                <DashboardCard
                    title="Google Sheet Sync"
                    desc="Manually sync live sheet data"
                    href="/files"
                    button="Sync"
                />

                <DashboardCard
                    title="Live Chat"
                    desc="Test chatbot responses instantly"
                    href="/chat"
                    button="Chat"
                />
            </section>

            {/* Footer */}
            <footer className="mt-16 border-t bg-white">
                <div className="max-w-6xl mx-auto px-6 py-4 text-sm text-gray-500">
                    © {new Date().getFullYear()} RAG Chatbot • Built for WhatsApp Automation
                </div>
            </footer>
        </main>
    );
}

/* ================== CARD COMPONENT ================== */

function DashboardCard({
    title,
    desc,
    href,
    button,
}: {
    title: string;
    desc: string;
    href: string;
    button: string;
}) {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex flex-col justify-between h-full">
                <div>
                    <h3 className="font-semibold text-lg mb-1">{title}</h3>
                    <p className="text-sm text-gray-600">{desc}</p>
                </div>

                <Link href={href} className="mt-6">
                    <Button className="w-full">{button}</Button>
                </Link>
            </CardContent>
        </Card>
    );
}
