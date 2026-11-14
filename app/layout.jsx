import "./globals.css";

export const metadata = {
  title: "Markdone — References",
  description: "Save and organize the posts and videos you want to come back to.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
