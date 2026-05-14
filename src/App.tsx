export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#3b82f6] via-[#8b5cf6] to-[#d946ef] flex items-center justify-center p-4">
      {/* 玻璃擬態卡片 */}
      <div className="bg-white/20 backdrop-blur-xl border border-white/30 p-10 rounded-[2.5rem] shadow-2xl text-center max-w-md w-full">
        <h1 className="text-white text-4xl font-black tracking-tight mb-4">
          還帳 App
        </h1>
        <div className="h-1 w-20 bg-white/50 mx-auto rounded-full mb-6"></div>
        <p className="text-white/90 text-lg font-medium">
          系統已成功部署
        </p>
        <p className="text-white/70 text-sm mt-2">
          Tailwind v4 穩定運行中
        </p>
      </div>
    </div>
  );
}



