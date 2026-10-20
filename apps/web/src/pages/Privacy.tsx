import './Home.css';
import './Privacy.css';

/** Fecha de la última versión del texto. Cambiarla si cambia el contenido. */
const UPDATED = '20 de octubre de 2026';
const CONTACT = 'josev.lopez.diaz@gmail.com';

/**
 * S4-00: política de privacidad en lenguaje llano. Vive en `#privacidad`.
 */
export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="home privacy">
      <div className="home-inner">
        <button type="button" className="profile-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Volver
        </button>

        <h1 className="privacy-title">Privacidad</h1>
        <p className="privacy-lead">
          Qué datos guardamos, para qué y cómo puedes verlos o borrarlos. Sin letra pequeña.
        </p>

        <section>
          <h2>Quién es el responsable</h2>
          <p>
            Jose Vicente López Díaz. Para cualquier cosa sobre tus datos, escribe a{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </section>

        <section>
          <h2>Si juegas sin cuenta (invitado)</h2>
          <ul>
            <li>Un identificador al azar que guardamos en una cookie de tu navegador, para saber que eres el mismo jugador de una partida a otra.</li>
            <li>El nombre que pones en la mesa.</li>
            <li>Tus partidas jugadas, ganadas y perdidas, y tu nivel de juego.</li>
          </ul>
          <p>No sabemos quién eres: no pedimos nombre real, email ni teléfono.</p>
        </section>

        <section>
          <h2>Si entras con Google</h2>
          <ul>
            <li>Tu nombre y tu email de Google, y un identificador de tu cuenta de Google.</li>
            <li>La fecha en que creaste la cuenta y la del último acceso.</li>
            <li>Tus partidas (con quién y contra quién jugaste, si ganaste y los puntos de nivel) y tus rachas.</li>
          </ul>
          <p>
            Google solo nos dice quién eres; no vemos tu contraseña ni nada más de tu cuenta. Tu nombre de Google no lo ven
            los demás jugadores: en la mesa se muestra el nombre que tú eliges.
          </p>
        </section>

        <section>
          <h2>Para qué los usamos</h2>
          <ul>
            <li>Para que puedas jugar y no pierdas tu progreso.</li>
            <li>Para emparejarte con jugadores de tu nivel.</li>
            <li>Para mostrarte tu perfil y tu historial.</li>
            <li>Para los rankings: si tienes cuenta, apareces con el nombre que eliges (nunca con tu email).</li>
          </ul>
          <p>
            Para evitar trampas, comprobamos si dos rivales de una partida juegan desde la misma conexión. Para eso usamos
            una huella anónima que se calcula al momento y no permite saber tu IP; tu IP no se guarda.
          </p>
          <p>No hay publicidad. No vendemos ni cedemos tus datos a nadie.</p>
        </section>

        <section>
          <h2>Cookies</h2>
          <p>Solo usamos cookies necesarias para que el juego funcione, ninguna de publicidad ni de estadísticas:</p>
          <ul>
            <li>
              <b>guinote_pid</b>: tu identificador de jugador (90 días).
            </li>
            <li>
              <b>guinote_sid</b>: tu sesión si entras con Google (180 días).
            </li>
          </ul>
          <p>Además, tu navegador recuerda tu nombre en la mesa, si tienes el sonido quitado y la mesa en la que estabas.</p>
        </section>

        <section>
          <h2>Dónde se guardan y cuánto tiempo</h2>
          <p>
            En los servidores de Microsoft Azure. Los datos de tu cuenta y tu historial se guardan mientras tengas la cuenta.
            Las partidas en curso se guardan como mucho 24 horas, para poder seguirlas si se corta la conexión.
          </p>
        </section>

        <section>
          <h2>Tus derechos</h2>
          <ul>
            <li>
              <b>Ver y llevarte tus datos</b>: en "Mi perfil" → "Descargar mis datos".
            </li>
            <li>
              <b>Borrarlo todo</b>: en "Mi perfil" → "Borrar mi cuenta". Se borran tu cuenta, tus partidas y tu nivel.
            </li>
            <li>
              Para corregir algo o cualquier otra petición, escribe a <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </li>
            <li>
              Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos
              (aepd.es).
            </li>
          </ul>
        </section>

        <p className="privacy-updated">Actualizado el {UPDATED}.</p>
      </div>
    </div>
  );
}
