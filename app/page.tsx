export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-16">
      <section className="space-y-6">
        <h1 className="text-4xl font-bold md:text-6xl">
          你好，我是张三
        </h1>

        <p className="max-w-2xl text-lg text-gray-600">
          欢迎来到我的个人网站。我会在这里展示项目、文章和个人经历。
        </p>

        <div className="flex gap-4">
          <a
            href="/projects"
            className="rounded-lg bg-blue-600 px-5 py-3 text-white"
          >
            查看项目
          </a>

          <a
            href="/about"
            className="rounded-lg border px-5 py-3"
          >
            关于我
          </a>
        </div>
      </section>
    </main>
  );
}