// Small server-generated PDF. The game's brute force unlocks access; the file
// itself is an ordinary PDF, rather than claiming real PDF password cracking.
const literal = value => String(value).replace(/[^\x20-\xff]/g, '').replace(/[\\()]/g, c => '\\' + c);
export function dossierPdf(teamName, accessCode) {
  const lines = [
    [54, 756, 24, 'THOR / DOSSIE DE ACESSO'],
    [54, 716, 14, `Equipe: ${teamName}`],
    [54, 676, 12, 'Todas as chaves foram reunidas e a busca guiada foi concluida.'],
    [54, 650, 12, 'Este documento autoriza sua equipe a entrar no Pentagono virtual.'],
    [54, 590, 13, 'CODIGO DE ACESSO DA EQUIPE'],
    [54, 550, 26, accessCode],
    [54, 490, 12, `No terminal da campanha, digite: connect ${accessCode}`],
    [54, 434, 12, '1. Cada integrante recebe uma estacao e pistas diferentes.'],
    [54, 410, 12, '2. Identifique IP, porta, credencial e etapa nos logs.'],
    [54, 386, 12, '3. Neutralize a IA antes de continuar o ataque.'],
    [54, 362, 12, '4. Todos precisam concluir para conquistar a bandeira mestra.'],
    [54, 292, 12, 'Protejam as chaves: perder uma suspende o avancamento da equipe.'],
    [54, 98, 10, 'Ambiente educacional. Todas as operacoes sao simuladas na arena.'],
    [54, 76, 10, 'Brute force guiada: esta atividade nao executa ataques externos.'],
  ];
  const stream = Buffer.from('0.12 0.3 0.18 rg\n54 792 487 5 re f\n0.08 0.13 0.1 rg\n' + lines.map(([x, y, size, text]) => `BT /F1 ${size} Tf ${x} ${y} Td (${literal(text)}) Tj ET`).join('\n'), 'latin1');
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'), Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'), Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')])];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
  objects.forEach((obj, index) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), obj, Buffer.from('\nendobj\n')]); chunks.push(chunk); length += chunk.length; });
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
