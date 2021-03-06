/**
 * @fileoverview WOLを送信可能なWebページを表示するhttpサーバー機能を実現する。
 * @description ポート番号3000でhttpサーバー機能を提供し、MacAccressList.json5から読み込んだ内容の
 *     MACアドレス宛てにWOLを送信するボタンを設置したWebページを表示する。
 * @todo MacAddressList.json5は適宜更新すること。
 * @see なし
 * @example なし
 * @license WTFPL-2.0
 */
const http = require('http');
const fs = require('fs');
const url = require('url');
const qs = require('querystring');
const json5 = require('json5');
const wol = require('wake_on_lan');
const os = require('os');

/**
 * 現在日時を文字列で取得する。
 *     フォーマットは yyyy/mm/dd hh:MM:ss とする。
 * @returns {String} 現在の日時を表す、フォーマット「yyyy/mm/dd hh:MM:ss」の文字列。
 */
const getCurrentDateString = () => {
  const d = new Date();
  return `${d.getFullYear()}/${('00' + (d.getMonth() + 1)).slice(-2)}/${('00' + d.getDate()).slice(-2)} ${('00' + d.getHours()).slice(-2)}:${('00' + d.getMinutes()).slice(-2)}:${('00' + d.getSeconds()).slice(-2)}`;
}

/**
 * IPv4アドレスとサブネットマスクからブロードキャストアドレスを算出する。
 * @param {String} ipv4Address ブロードキャストアドレス確認対象のIPv4アドレス。
 * @param {String} subnetMask ブロードキャストアドレス確認対象のIPv4アドレスのサブネットマスク。
 * @returns {String} IPv4ブロードキャストアドレスを表す文字列。
 */
const getBroadcastIPv4Address = (ipv4Address, subnetMask) => {
  const ipv4AddressArray = ipv4Address.split('.'); // 例：192.168.11.1 を[192, 168, 11, 1]の配列にする。
  const subnetMaskArray = subnetMask.split('.');   // 例：255.255.255.0を[255, 255, 255, 0]の配列にする。
  const ipv4NetworkAddressArray = [                // IPv4アドレスのネットワークアドレスを算出する。
    ipv4AddressArray[0] & subnetMaskArray[0],
    ipv4AddressArray[1] & subnetMaskArray[1],
    ipv4AddressArray[2] & subnetMaskArray[2],
    ipv4AddressArray[3] & subnetMaskArray[3],
  ];
  const ipv4BroadcastAddressArray = [              // IPv4アドレスのブロードキャストアドレスを算出する。
    ipv4NetworkAddressArray[0] | (~subnetMaskArray[0] & 255),
    ipv4NetworkAddressArray[1] | (~subnetMaskArray[1] & 255),
    ipv4NetworkAddressArray[2] | (~subnetMaskArray[2] & 255),
    ipv4NetworkAddressArray[3] | (~subnetMaskArray[3] & 255),
  ];

  return ipv4BroadcastAddressArray.join('.');
}

/**
 * WOLを発行するWebページのテンプレート。
 *     "<% REPLACE %>"はMacAddressList.json5の内容に置換する。
 * @type {String}
 */
const htmlTemplate = `<!doctype html>
<html>
<head>
  <meta charset="utf8">
  <title>WOL via WebPage</title>
  <style type="text/css">
  table { border-collapse: collapse; }
  table th { border-style: solid; border-width: 1px; }
  table td { border-style: solid; border-width: 1px; }
  .r { text-align: right; }
  </style>
</head>
<body>
  <header>
    <h1>WOL via WebPage</h1>
  </header>
  <form method="post" action="/">
    <table>
      <tr><th rowspan="2">No</th><th colspan="3">宛先PC情報</th><th rowspan="2">送信ボタン</th><th rowspan="2">送信ステータス</th></tr>
      <tr><th>ユーザー名</th><th>PC名</th><th>MACアドレス</th></tr><% REPLACE %>
    </table>
  </form>
</body>
</html>`;

/**
 * 表示するHTMLソースを生成する。
 * @param {Array} statusList WOLを送信したステータスのリスト。
 * @returns {String} 表示するHTMLソース。
 */
const createHtmlData = (statusList = []) => {
  // WOL送信対象を表示するテーブルの行を生成する。
  let no = 0;          // 「No」列の値。
  let userName = '';   // 「ユーザー名」列の値。
  let pcName = '';     // 「PC名」列の値。
  let macAddress = ''; // 「MACアドレス」列の値。
  let status = '';     // 「送信ステータス」列の値。
  let trData = '';     //  上記の「No」列～「送信ステータス」列の値でtr列を生成する変数。
  let data = '';       //  ルートアドレスに表示するhtmlソースを保持する変数。htmlTemplateとtrDataでソースを生成する。

  // 指定フォルダ内に「MacAddressList.json5」が存在する場合は内容を取得する。
  // 取得できた場合はパースし、存在しない場合は例外が発生する。
  try {
    const json5Data = fs.readFileSync(`./MacAddressList.json5`);
    const macAddressList = json5.parse(json5Data).macAddressList;

    for(const value of macAddressList) {
      userName = value.userName;
      pcName = value.pcName;
      macAddress = value.macAddress;
      status = (statusList.length > 0) ? statusList[no]: '';
      no++;
      trData += `\n      <tr><td class="r">${no}</td><td>${userName}</td><td>${pcName}</td><td>${macAddress}<input type="hidden" name="targetmacaddress" value="${macAddress}"/></td><td><button name="action" value="${no}">WOL送信</button></td><td><input type="text" name="status" size="90" value="${status}" /></td></tr>`;
    }

    data = htmlTemplate.replace('<% REPLACE %>', trData);
  } catch (e) {
    data = '\n      <tr><td colspan="6">MacAddressList.json5が存在しません。</td></tr>';
    console.log(`${e}`);
  }

  return data;
}

//==========================
// httpサーバーを開始する。
//==========================
const server = http.createServer(
  (request, response) => {
    const url_parts = url.parse(request.url, true);
    const decodeUrl = decodeURI(url_parts.pathname);

    switch (decodeUrl) {
      case '/':
        let htmlData = '';
        if (request.method === 'POST') {
            let postData = '';

            // データ受信が完全に完了するまで受信を続ける。
            request.on('data', (data) => {
              postData += data;
            });

            // データ受信が完了した後にWOLの発行とページ更新を行う。
            request.on('end', () => {
              const parsedPostData = qs.parse(postData);
              const dataIndex = parsedPostData.action - 1; // actionには「No」列の値が入っているので、インデックスを指すために-1する。
              const targetMacAddresses = (Array.isArray(parsedPostData.targetmacaddress) == true) ? parsedPostData.targetmacaddress: parsedPostData.targetmacaddress.split(','); // 指定されたMACアドレスを配列化するため、絶対にありえない"."でsplitする。
              const targetMacAddress = targetMacAddresses[dataIndex];
              const statuses = (Array.isArray(parsedPostData.status) == true) ? parsedPostData.status: parsedPostData.status.split(',') ; // もともとページに書かれていたステータスを維持しつつ配列化するため、絶対にありえない"."でsplitする。
              const broadcastIPv4Addresses = [];

              // ブロードキャストIPv4アドレスを生成する。
              const interfaces = os.networkInterfaces();
              Object.keys(interfaces).forEach((interfaceName) => {
                interfaces[interfaceName].forEach((interface) => {
                  if (interface.internal === false && interface.family === "IPv4") {
                    broadcastIPv4Addresses.push(getBroadcastIPv4Address(interface.address, interface.netmask));
                  }
                });
              });

              // https://www.npmjs.com/package/wake_on_lan#windows-notes より、
              // Windowsの場合はwakeメソッドへIPv4ブロードキャストアドレスを指定する。
              if (os.platform() === 'win32') {
                for(value of broadcastIPv4Addresses) {
                  wol.wake(targetMacAddress, { address: value });
                }
              } else {
                wol.wake(targetMacAddress);
              }

              statuses[dataIndex] = `${getCurrentDateString()} | ${targetMacAddress} | Sent magic packet to ${broadcastIPv4Addresses}`;
              htmlData = createHtmlData(statuses);

              response.writeHead(200, { 'Content-Type': 'text/html' }); // response.writeHead(303, { 'Location': '/' }); // このやり方でindexページへ303リダイレクトしたほうが良い？
              response.write(htmlData);
              response.end();
            });
         }
         else {
          // 通常通りWebページへアクセスするとGETメソッドが実行されるのでこちらのルートに入る。
          htmlData = createHtmlData();

          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.write(htmlData);
          response.end();
        }
        break;

      default:
        //------------------------------------------------------------------------------
        // '/'以外のURLを指定した場合は"no data..."と表示する。
        // chromeでアドレスを開くと、favicon未設定でも./favicon.icoがこのルートに入る。
        //------------------------------------------------------------------------------
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('no data...');
        break;
    }
  }
);

server.listen(3000);
console.log(`Start server@${getCurrentDateString()}`);
