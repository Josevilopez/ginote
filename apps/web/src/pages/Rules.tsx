import './Home.css';
import './Privacy.css';
import './Rules.css';

/**
 * "Cómo se juega": las reglas del guiñote aragonés tal y como las aplica
 * esta mesa (ver `GUINOTE_ARAGONES` en el motor). Vive en `/como-se-juega`
 * (con HTML ya generado para los buscadores) y en `#reglas`.
 */
const CARDS: { file: string; name: string; points: number }[] = [
  { file: '01-oros', name: 'As', points: 11 },
  { file: '03-oros', name: 'Tres', points: 10 },
  { file: '12-oros', name: 'Rey', points: 4 },
  { file: '10-oros', name: 'Sota', points: 3 },
  { file: '11-oros', name: 'Caballo', points: 2 },
];

const INDEX = [
  ['resumen', 'En pocas palabras'],
  ['cartas', 'Las cartas'],
  ['reparto', 'Reparto y triunfo'],
  ['bazas', 'Las bazas'],
  ['arrastre', 'El arrastre'],
  ['cantes', 'Cantes y el siete'],
  ['puntos', 'Puntos y partida'],
  ['coto', 'El coto'],
  ['trucos', 'Trucos de la mesa'],
  ['glosario', 'Palabras del guiñote'],
] as const;

export function Rules({ onBack }: { onBack: () => void }) {
  const go = (id: string) => document.getElementById(`reglas-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="home privacy rules">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          <svg className="back-arrow" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>{' '}
          Volver
        </button>

        <h1 className="privacy-title">Cómo se juega al guiñote</h1>
        <p className="privacy-lead">El guiñote aragonés, como se juega en esta mesa. En cada pueblo hay algún matiz; aquí van las reglas que sigue el juego.</p>

        <nav className="rules-index" aria-label="Índice">
          {INDEX.map(([id, label]) => (
            <button key={id} type="button" onClick={() => go(id)}>
              {label}
            </button>
          ))}
        </nav>

        <section id="reglas-resumen" className="rules-summary">
          <h2>En pocas palabras</h2>
          <ul>
            <li>
              <b>Cuatro jugadores, dos parejas.</b> Tu compañero se sienta enfrente.
            </li>
            <li>
              Cada baza se la lleva la carta más alta del palo que ha salido, o el <b>triunfo</b> más alto.
            </li>
            <li>
              Se suman los puntos de las cartas ganadas y los <b>cantes</b>. Gana la partida la pareja que pasa de <b>100 puntos</b>.
            </li>
            <li>
              La pareja que gana <b>3 partidas</b> se lleva el <b>coto</b>.
            </li>
          </ul>
        </section>

        <section id="reglas-cartas">
          <h2>Las cartas</h2>
          <p>
            Se juega con la baraja española sin ochos ni nueves: <b>40 cartas</b>, diez de cada palo (oros, copas, espadas y bastos). Solo
            cinco cartas de cada palo valen puntos:
          </p>
          <ul className="rules-cards" aria-label="Cartas que dan puntos">
            {CARDS.map((c) => (
              <li key={c.file}>
                <img src={`/cards/sprite/${c.file}.png`} alt="" width={56} height={86} loading="lazy" />
                <b>{c.name}</b>
                <span>{c.points} puntos</span>
              </li>
            ))}
          </ul>
          <p>
            El siete, seis, cinco, cuatro y dos no valen puntos. Para ganar una baza, el orden de fuerza es:
          </p>
          <p className="rules-order">As · Tres · Rey · Sota · Caballo · 7 · 6 · 5 · 4 · 2</p>
          <p className="rules-note">
            Ojo: en el guiñote la <b>sota vale más que el caballo</b>, al revés que en otros juegos.
          </p>
        </section>

        <section id="reglas-reparto">
          <h2>Reparto y triunfo</h2>
          <ul>
            <li>Se reparten <b>6 cartas</b> a cada jugador, de tres en tres.</li>
            <li>
              La siguiente carta se pone boca arriba: su palo es el <b>triunfo</b> («pintan oros») y gana a cualquier carta de otro palo. Queda
              debajo del montón (el <b>mazo</b>) y será la última en robarse.
            </li>
            <li>Se juega hacia la derecha. Empieza el jugador a la derecha del que reparte, y quien reparte va cambiando en cada partida.</li>
          </ul>
        </section>

        <section id="reglas-bazas">
          <h2>Las bazas</h2>
          <ul>
            <li>Cada jugador echa una carta. La baza se la lleva la carta más alta del palo que ha salido, o el triunfo más alto si alguien ha echado triunfo.</li>
            <li>
              Mientras quedan cartas en el mazo <b>puedes echar la carta que quieras</b>: no hace falta seguir el palo ni matar.
            </li>
            <li>Después de cada baza se roba una carta: primero quien la ha ganado y luego los demás, por orden. Quien gana la baza sale en la siguiente.</li>
          </ul>
        </section>

        <section id="reglas-arrastre">
          <h2>El arrastre</h2>
          <p>
            Cuando se acaba el mazo empieza el <b>arrastre</b> y cambian las normas. Ahora es obligatorio:
          </p>
          <ol className="rules-steps">
            <li>
              <b>Seguir el palo</b> que ha salido, si tienes.
            </li>
            <li>
              <b>Matar</b>: echar una carta más alta de ese palo, si puedes.
            </li>
            <li>
              Si no tienes del palo, <b>fallar con triunfo</b>, si tienes.
            </li>
          </ol>
          <p>Y dos excepciones que se agradecen:</p>
          <ul>
            <li>
              Si la baza la va ganando <b>tu compañero</b>, no hace falta matar ni fallar: puedes echar lo que quieras del palo (o cualquier carta si no
              tienes).
            </li>
            <li>Si ya hay un triunfo en la mesa y el tuyo no lo supera, no estás obligado a echarlo.</li>
          </ul>
          <p className="rules-note">El juego solo te deja tocar las cartas que se pueden echar, así que no hay renuncios.</p>
        </section>

        <section id="reglas-cantes">
          <h2>Cantes y el siete</h2>
          <ul>
            <li>
              Tener el <b>rey y la sota del mismo palo</b> es un cante: vale <b>20 puntos</b>, o <b>40</b> si es del palo de triunfo («cantar las cuarenta»).
            </li>
            <li>
              Solo se canta <b>después de ganar una baza</b>: puede cantar quien la ha ganado o su compañero. También se puede cantar en el arrastre. Cada palo
              se canta una vez.
            </li>
            <li>
              <b>Cambiar el siete</b>: si tienes el siete de triunfo y has ganado la última baza, en tu turno puedes cambiarlo por la carta de triunfo que
              está boca arriba. Solo mientras quede mazo.
            </li>
          </ul>
          <p className="rules-note">Cuando puedas cantar o cambiar el siete, te aparecerá el botón en la mesa.</p>
        </section>

        <section id="reglas-puntos">
          <h2>Puntos y partida</h2>
          <ul>
            <li>
              Al final se suman los puntos de las cartas de las bazas ganadas, los cantes y las <b>10 de últimas</b>: diez puntos para quien se lleva la
              última baza. Entre las cartas y las últimas hay 130 puntos en juego.
            </li>
            <li>
              Los primeros 50 puntos son <b>malas</b> y los que pasan de 50, <b>buenas</b>: 85 puntos son «35 buenas». Gana la partida la pareja que
              pasa de 100, es decir, que hace <b>51 buenas</b>.
            </li>
            <li>
              Si al acabar las cartas nadie ha pasado de 100, se juega otra mano, <b>de vueltas</b>, sumando a lo que ya teníais. En las vueltas, en
              cuanto una pareja pasa de 100 la mano se corta y gana.
            </li>
          </ul>
          <p className="rules-note">En la mesa, el marcador pinta los puntos en rojo mientras son malas y en blanco cuando ya son buenas.</p>
        </section>

        <section id="reglas-coto">
          <h2>El coto</h2>
          <ul>
            <li>
              Un <b>coto</b> lo gana la pareja que gana <b>3 partidas</b>.
            </li>
            <li>
              En <b>Jugar online</b> se juega un coto y, al acabar, podéis pedir la revancha. En las <b>mesas privadas</b> se elige cuántas partidas tiene el coto
              y a cuántos cotos se juega (lo clásico en muchos pueblos: el que gana dos cotos).
            </li>
            <li>Si alguien se va o se le cae la conexión más de 45 segundos, un bot juega por él hasta el final.</li>
          </ul>
        </section>

        <section id="reglas-trucos">
          <h2>Trucos de la mesa</h2>
          <ul>
            <li>
              Mientras hay mazo, <b>descártate</b> de los palos en los que no tienes ases ni treses, y mejor de un palo distinto al que se descarta tu compañero.
            </li>
            <li>Guarda los triunfos para el arrastre. Matar con triunfo antes de tiempo solo compensa si hay puntos en la mesa (unos 10 o más).</li>
            <li>
              En la última baza antes del arrastre suele convenir <b>no ganarla</b>: quien la gana sale el primero en el arrastre, que es lo peor, y
              el triunfo de la mesa se lo lleva el último en robar.
            </li>
            <li>Si tu compañero va ganando la baza, <b>carga</b>: échale cartas con puntos.</li>
            <li>Lleva la cuenta de los ases, treses y triunfos que han salido. Quien llega al arrastre con más triunfos suele ganar la partida.</li>
            <li>No vale hacerse señas… aunque dicen que el nombre del juego viene de los guiños entre compañeros 😉.</li>
          </ul>
        </section>

        <section id="reglas-glosario">
          <h2>Palabras del guiñote</h2>
          <dl className="rules-glossary">
            <dt>Arrastrar</dt>
            <dd>En el arrastre, salir de un palo (sobre todo de triunfo) para obligar a los demás a echarlo.</dd>
            <dt>Baza</dt>
            <dd>Las cuatro cartas de una ronda. Se las lleva quien echa la más alta.</dd>
            <dt>Buenas y malas</dt>
            <dd>Los puntos por encima de 50 (buenas) y hasta 50 (malas).</dd>
            <dt>Cantar</dt>
            <dd>Anunciar rey y sota del mismo palo: 20 puntos, o 40 si son de triunfo.</dd>
            <dt>Cargar</dt>
            <dd>Echar una carta con puntos cuando tu compañero va ganando la baza.</dd>
            <dt>Coto</dt>
            <dd>Tres partidas ganadas.</dd>
            <dt>Fallar</dt>
            <dd>No tener del palo que ha salido y echar triunfo.</dd>
            <dt>Guiñote</dt>
            <dd>Un as o un tres, las cartas que más valen.</dd>
            <dt>Mano</dt>
            <dd>Quien sale en la primera baza: el de la derecha del que reparte.</dd>
            <dt>Matar</dt>
            <dd>Echar una carta que supera a la que va ganando la baza.</dd>
            <dt>Mazo</dt>
            <dd>El montón de cartas del que se roba.</dd>
            <dt>Pintar</dt>
            <dd>Ser el palo de triunfo: «pintan bastos».</dd>
            <dt>Vueltas</dt>
            <dd>La segunda mano, cuando nadie ha pasado de 100 en la primera.</dd>
            <dt>10 de últimas</dt>
            <dd>Los diez puntos para quien gana la última baza.</dd>
          </dl>
        </section>

        <a className="home-choice is-main rules-cta" href="/">
          <b>¡A jugar!</b>
          <span>Gratis, desde el móvil o el ordenador, sin descargar nada.</span>
        </a>

        <p className="privacy-updated">
          Basado en las reglas tradicionales del guiñote aragonés. Si en tu pueblo se juega distinto, ¡cuéntanoslo!
        </p>
      </div>
    </div>
  );
}
