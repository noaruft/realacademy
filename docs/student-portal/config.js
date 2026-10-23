// 生徒用ページの設定
// supabaseUrl と supabaseAnonKey が空のあいだは「お試しモード」で動きます
// （データはこのブラウザの中だけに保存され、本番のデータには触れません）。
// Supabase のプロジェクトを作ったら、Project Settings → API の値を貼り付けてください。
window.PORTAL_CONFIG = {
  supabaseUrl: "https://cfippqerprnkeldozhhg.supabase.co",
  // anon public キー（公開して問題ないキーです）
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmaXBwcWVycHJua2VsZG96aGhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyOTYwMTgsImV4cCI6MjEwNzg3MjAxOH0.i-nOPUGGPQryTqgSCtvT2hg3RGQjJvHtVuRMB17SKI8",

  // ログインIDをSupabaseのメールアドレス形式に変換するためのドメイン。
  // 実際にメールは送られません。tools/import_students.py の LOGIN_DOMAIN と同じ値にしてください。
  loginDomain: "students.realacademy.co.jp",

};
